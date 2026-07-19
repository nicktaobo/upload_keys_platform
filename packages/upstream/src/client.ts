import type { z } from "zod";

import { contracts } from "./contracts.js";
import type {
  SubmitKeyRow,
  UpstreamBatchNote,
  UpstreamBatchSummary,
  UpstreamChannel,
  UpstreamItemsPage,
  UpstreamSubmissionResponse,
  UpstreamSubmissionResult,
} from "./contracts.js";
import {
  CaptchaRequiredError,
  UpstreamContractError,
  UpstreamHttpError,
} from "./errors.js";

export interface SupplierPortalClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

interface Parser<T> {
  safeParse(data: unknown): z.SafeParseReturnType<unknown, T>;
}

interface RequestOptions<T> {
  method?: "GET" | "POST";
  body?: unknown;
  contract: string;
  schema: Parser<T>;
  allowRenewal?: boolean;
}

const API_PREFIX = "/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export class SupplierPortalClient {
  readonly #baseUrl: URL;
  readonly #username: string;
  readonly #password: string;
  readonly #timeoutMs: number;
  readonly #cookies = new Map<string, string>();

  constructor(options: SupplierPortalClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    this.#username = options.username;
    this.#password = options.password;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (this.#timeoutMs <= 0 || !Number.isFinite(this.#timeoutMs)) {
      throw new TypeError("timeoutMs must be a positive finite number");
    }
  }

  async login(): Promise<void> {
    this.#cookies.clear();
    const response = await this.#fetch("/auth/login", {
      method: "POST",
      body: { username: this.#username, password: this.#password },
      includeCsrf: false,
    });
    const payload = await readJson(response);
    if (isCaptchaChallenge(payload)) throw new CaptchaRequiredError();
    if (!response.ok) throw new UpstreamHttpError({ status: response.status });
    if (!isLoginResponse(payload) || !this.#cookies.has("sessionid") || !this.#csrfToken()) {
      throw new UpstreamContractError("login");
    }
  }

  getChannels(): Promise<UpstreamChannel[]> {
    return this.#request<UpstreamChannel[]>("/supplier-portal/channels/", {
      contract: "channels",
      schema: contracts.channels,
    });
  }

  submitKeys(
    channelId: string,
    rows: SubmitKeyRow[],
  ): Promise<UpstreamSubmissionResult> {
    const requestRows = rows.map(({ apiKey, warrantyHours }) => ({
      row_id: crypto.randomUUID(),
      official_credential: { api_key: apiKey },
      quota_unlimited: true,
      consumption_time_follow_parent: false,
      consumption_time_hours: warrantyHours,
    }));
    return this.#request<UpstreamSubmissionResponse>(
      `/supplier-portal/channels/${encodeURIComponent(channelId)}/items/submit/`,
      {
        method: "POST",
        body: { rows: requestRows },
        contract: "submission",
        schema: contracts.submission,
      },
    ).then((response) => mapSubmissionResponse(requestRows, response));
  }

  getItems(channelId: string, cursor?: string): Promise<UpstreamItemsPage> {
    const query = cursor === undefined
      ? ""
      : `?${new URLSearchParams({ cursor }).toString()}`;
    return this.#request<UpstreamItemsPage>(
      `/supplier-portal/channels/${encodeURIComponent(channelId)}/items/${query}`,
      { contract: "items", schema: contracts.items },
    );
  }

  getBatchSummary(channelId: string): Promise<UpstreamBatchSummary> {
    return this.#request<UpstreamBatchSummary>(
      `/supplier-portal/channels/${encodeURIComponent(channelId)}/batch-summary/`,
      { contract: "batch summary", schema: contracts.batchSummary },
    );
  }

  getBatchNotes(channelId: string): Promise<UpstreamBatchNote[]> {
    return this.#request<UpstreamBatchNote[]>(
      `/supplier-portal/channels/${encodeURIComponent(channelId)}/batch-notes/`,
      { contract: "batch notes", schema: contracts.batchNotes },
    );
  }

  async #request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const response = await this.#fetch(path, {
      method: options.method ?? "GET",
      body: options.body,
      includeCsrf: options.method === "POST",
    });
    const payload = await readJson(response);
    const canRenew = options.allowRenewal ?? true;

    if (canRenew && isExpiredSession(response.status, payload)) {
      await this.login();
      return this.#request(path, { ...options, allowRenewal: false });
    }
    if (!response.ok) throw new UpstreamHttpError({ status: response.status });

    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) throw new UpstreamContractError(options.contract);
    return parsed.data;
  }

  async #fetch(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown; includeCsrf: boolean },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const headers = new Headers({ accept: "application/json" });
    const cookie = this.#cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.includeCsrf) {
      const csrfToken = this.#csrfToken();
      if (!csrfToken) throw new UpstreamContractError("CSRF session");
      headers.set("X-CSRFToken", csrfToken);
    }

    try {
      const response = await fetch(new URL(`${API_PREFIX}${path}`, this.#baseUrl), {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      this.#storeCookies(response.headers);
      return response;
    } catch (error: unknown) {
      if (isAbortError(error)) throw new UpstreamHttpError({ code: "TIMEOUT" });
      throw new UpstreamHttpError({ code: "NETWORK_ERROR" });
    } finally {
      clearTimeout(timeout);
    }
  }

  #storeCookies(headers: Headers): void {
    const getSetCookie = (
      headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie;
    const cookieHeaders = getSetCookie === undefined
      ? splitSetCookieHeader(headers.get("set-cookie"))
      : getSetCookie.call(headers);
    for (const header of cookieHeaders) {
      const pair = header.split(";", 1)[0];
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value) this.#cookies.set(name, value);
      else this.#cookies.delete(name);
    }
  }

  #cookieHeader(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  #csrfToken(): string | undefined {
    return this.#cookies.get("csrftoken");
  }
}

function mapSubmissionResponse(
  requestRows: Array<{
    row_id: string;
    official_credential: { api_key: string };
  }>,
  response: UpstreamSubmissionResponse,
): UpstreamSubmissionResult {
  const requestedIds = new Set(requestRows.map(({ row_id }) => row_id));
  const byRowId = new Map(
    response.results.map((result) => [result.row_id, result] as const),
  );
  const responseIsCorrelated = response.results.length === requestRows.length
    && byRowId.size === response.results.length
    && response.results.every(({ row_id }) => requestedIds.has(row_id));
  if (!responseIsCorrelated) {
    throw new UpstreamContractError("submission row correlation");
  }
  if (response.results.some(
    ({ status, item }) => status === "submitted" && item === undefined,
  )) {
    throw new UpstreamContractError("submission item identity");
  }

  const itemIds = requestRows.flatMap(({ row_id }) => {
    const result = byRowId.get(row_id);
    return result?.status === "submitted" && result.item
      ? [result.item.id]
      : [];
  });
  const firstFailure = requestRows
    .map(({ row_id }) => byRowId.get(row_id))
    .find((result) => result?.status === "failed");
  let failureMessage = firstFailure?.message?.trim();
  const requestKeys = [...new Set(
    requestRows
      .map(({ official_credential }) => official_credential.api_key)
      .filter((apiKey) => apiKey.length > 0),
  )].sort((left, right) => right.length - left.length);
  for (const apiKey of requestKeys) {
    failureMessage = failureMessage?.replaceAll(apiKey, "[REDACTED_KEY]");
  }
  failureMessage = failureMessage
    ?.replace(/sk-ant-[A-Za-z0-9_-]+/gu, "[REDACTED_KEY]")
    .slice(0, 500);
  return {
    success: requestRows.every(({ row_id }) => {
      const result = byRowId.get(row_id);
      return result?.status === "submitted" && result.item !== undefined;
    }),
    itemIds,
    ...(failureMessage ? { failureMessage } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isLoginResponse(payload: unknown): boolean {
  return isRecord(payload) && payload.success !== false;
}

function isCaptchaChallenge(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (payload.captcha_required === true || payload.requires_captcha === true) return true;
  const values = [payload.code, payload.error, payload.detail];
  return values.some(
    (value) => typeof value === "string" && /captcha/i.test(value),
  );
}

function isExpiredSession(status: number, payload: unknown): boolean {
  if (status === 401) return true;
  if (status !== 403 || !isRecord(payload)) return false;
  const values = [payload.code, payload.error, payload.detail];
  return values.some(
    (value) =>
      typeof value === "string"
      && /(?:session|csrf|auth).*(?:expired|invalid)|(?:expired|invalid).*(?:session|csrf|auth)/i.test(value),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function splitSetCookieHeader(header: string | null): string[] {
  return header?.split(/,(?=\s*[^;,\s]+=)/u) ?? [];
}
