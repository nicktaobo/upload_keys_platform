export type Role = "user" | "admin";
type ApiRole = "USER" | "ADMIN";
export type KeyStatus = "pending" | "submitting" | "submitted" | "test_failed" | "retrying" | "upstream_error";
type ApiKeyStatus = "PENDING" | "SUBMITTING" | "SUBMITTED" | "TEST_FAILED" | "RETRYING" | "UPSTREAM_ERROR";

export interface SessionUser { id: string; username: string; role: Role }
export interface KeyRecord {
  id: string;
  maskedKey: string;
  warrantyHours: number;
  status: KeyStatus;
  testResult: string | null;
  accessStatus: string | null;
  usageUsd: number;
  usageSiteCount: number;
  sampledAt: string | null;
  submittedAt: string | null;
  failureMessage?: string | null;
  owner?: { id: string; username: string };
}
export interface KeySummary { total: number; healthy: number; usageUsd: number; latestSampleAt: string | null }
export interface ApiUser { id: string; username: string; role: Role; isActive: boolean }
interface RawSessionUser { id: string; username: string; role: ApiRole }
interface RawApiUser { id: string; username: string; role: ApiRole; isActive: boolean }
interface RawKeyRecord extends Omit<KeyRecord, "status" | "usageUsd"> {
  status: ApiKeyStatus;
  usageUsd: number | string;
}
interface RawKeySummary {
  submittedCount: number;
  healthyCount: number;
  usageUsd: number;
  latestSampleAt: string | null;
}
export interface UpstreamConnection {
  state: "connected" | "disconnected" | "blocked";
  failureMessage: string | null;
  lastLoginAt: string | null;
  lastSyncAt: string | null;
  username: string;
}
export interface BatchError { row: number; message: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: BatchError[] = [],
  ) { super(message); }
}

let csrfToken: string | null = null;
const normalizeRole = (role: ApiRole): Role => role === "ADMIN" ? "admin" : "user";
const normalizeSessionUser = (user: RawSessionUser): SessionUser => ({ ...user, role: normalizeRole(user.role) });
const normalizeApiUser = (user: RawApiUser): ApiUser => ({ ...user, role: normalizeRole(user.role) });
const normalizeKey = (record: RawKeyRecord): KeyRecord => ({
  ...record,
  status: record.status.toLowerCase() as KeyStatus,
  usageUsd: Number(record.usageUsd),
});

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(method !== "GET" && csrfToken ? { "X-CSRF-Token": csrfToken } : {}), ...init.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    csrfToken?: string;
    issues?: BatchError[];
  };
  if (!response.ok) {
    throw new ApiError(payload.message ?? "Request failed", response.status, payload.issues ?? []);
  }
  if (payload.csrfToken) csrfToken = payload.csrfToken;
  return payload as T;
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  me: async () => { const result = await request<{ user: RawSessionUser; csrfToken: string }>("/auth/me"); return { ...result, user: normalizeSessionUser(result.user) }; },
  login: async (username: string, password: string) => { const result = await post<{ user: RawSessionUser; csrfToken: string }>("/auth/login", { username, password }); return { ...result, user: normalizeSessionUser(result.user) }; },
  logout: async () => { try { await post<void>("/auth/logout"); } finally { csrfToken = null; } },
  summary: async () => {
    const result = await request<RawKeySummary>("/keys/summary");
    return {
      total: result.submittedCount,
      healthy: result.healthyCount,
      usageUsd: Number(result.usageUsd),
      latestSampleAt: result.latestSampleAt,
    };
  },
  keys: async (status?: KeyStatus) => {
    const result = await request<{ items: RawKeyRecord[]; total: number }>(
      `/keys${status ? `?status=${status.toUpperCase()}` : ""}`,
    );
    return { ...result, items: result.items.map(normalizeKey) };
  },
  refresh: () => post<{ message: string }>("/keys/refresh"),
  reveal: async (id: string) => {
    const result = await post<{ apiKey: string }>(`/keys/${id}/reveal`);
    return { key: result.apiKey };
  },
  submit: async (key: string, warrantyHours: number) => {
    const result = await post<{ created: Array<{ id: string }> }>("/keys", {
      mode: "single",
      apiKey: key,
      warrantyHours,
    });
    return { accepted: result.created.length, errors: [] as BatchError[] };
  },
  submitBatch: async (rows: string) => {
    try {
      const result = await post<{ created: Array<{ id: string }> }>("/keys", {
        mode: "batch",
        text: rows,
      });
      return { accepted: result.created.length, errors: [] as BatchError[] };
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) {
        return { accepted: 0, errors: error.issues };
      }
      throw error;
    }
  },
  adminUsers: async () => ({ items: (await request<RawApiUser[]>("/admin/users")).map(normalizeApiUser) }),
  createUser: async (body: { username: string; password: string; role: Role }) => {
    const user = await post<RawApiUser>("/admin/users", { ...body, role: body.role.toUpperCase() });
    return { user: normalizeApiUser(user) };
  },
  setUserStatus: (id: string, isActive: boolean) => post<void>(`/admin/users/${id}/status`, { isActive }),
  resetPassword: (id: string, password: string) => post<void>(`/admin/users/${id}/reset-password`, { password }),
  adminKeys: async () => {
    const result = await request<{ items: RawKeyRecord[]; total: number }>("/admin/keys");
    return { ...result, items: result.items.map(normalizeKey) };
  },
  retryKey: (id: string) => post<{ message: string }>(`/admin/keys/${id}/retry`),
  upstream: () => request<UpstreamConnection>("/admin/upstream"),
  saveUpstream: (username: string, password: string) => request<void>("/admin/upstream", { method: "PUT", body: JSON.stringify({ username, password }) }),
  syncNow: () => post<{ message: string }>("/admin/upstream/sync"),
};
