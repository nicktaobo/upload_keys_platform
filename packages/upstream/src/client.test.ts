import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  CaptchaRequiredError,
  SupplierPortalClient,
  UpstreamContractError,
  UpstreamHttpError,
} from "./index.js";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
) => void | Promise<void>;

const servers: Array<ReturnType<typeof createServer>> = [];

async function startServer(handler: Handler): Promise<string> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const source = Buffer.concat(chunks).toString("utf8");
    const body: unknown = source ? JSON.parse(source) : undefined;
    await handler(request, response, body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("SupplierPortalClient", () => {
  it("logs in, retains cookies, and sends CSRF on submission", async () => {
    const requests: Array<{
      method: string | undefined;
      path: string | undefined;
      cookie: string | undefined;
      csrf: string | undefined;
      body: unknown;
    }> = [];
    const baseUrl = await startServer((request, response, body) => {
      requests.push({
        method: request.method,
        path: request.url,
        cookie: request.headers.cookie,
        csrf: request.headers["x-csrftoken"] as string | undefined,
        body,
      });
      if (request.url === "/api/v1/auth/login") {
        json(response, 200, { success: true }, {
          "set-cookie": [
            "sessionid=session-secret; HttpOnly; Path=/",
            "csrftoken=csrf-secret; Path=/",
          ],
        });
        return;
      }
      json(response, 200, { success: true, itemIds: ["item-1"] });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier",
      password: "password-secret",
    });

    await client.login();
    await expect(
      client.submitKeys("channel / one", [
        { apiKey: "sk-ant-api03-super-secret", warrantyHours: 24 },
      ]),
    ).resolves.toEqual({ success: true, itemIds: ["item-1"] });

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/auth/login",
        cookie: undefined,
        csrf: undefined,
        body: { username: "supplier", password: "password-secret" },
      },
      {
        method: "POST",
        path: "/api/v1/supplier-portal/channels/channel%20%2F%20one/items/submit/",
        cookie: expect.stringContaining("sessionid=session-secret"),
        csrf: "csrf-secret",
        body: {
          rows: [
            { apiKey: "sk-ant-api03-super-secret", warrantyHours: 24 },
          ],
        },
      },
    ]);
    expect(requests[1]?.cookie).toContain("csrftoken=csrf-secret");
  });

  it("calls every supplier portal read path and maps stable responses", async () => {
    const paths: string[] = [];
    const baseUrl = await startServer((request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/api/v1/auth/login") {
        json(response, 200, { success: true }, {
          "set-cookie": ["sessionid=s1; Path=/", "csrftoken=c1; Path=/"],
        });
      } else if (request.url === "/api/v1/supplier-portal/channels/") {
        json(response, 200, { results: [{ id: 7, name: "Claude" }] });
      } else if (request.url?.includes("/items/?cursor=")) {
        json(response, 200, {
          results: [{ id: 9, status: "active", usage_usd: 1.25 }],
          next: "next-page",
        });
      } else if (request.url?.endsWith("/batch-summary/")) {
        json(response, 200, { total: 4, healthy: 3, usage_usd: 2.5 });
      } else {
        json(response, 200, [{ id: 2, message: "queued" }]);
      }
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier",
      password: "password",
    });
    await client.login();

    await expect(client.getChannels()).resolves.toEqual([
      { id: "7", name: "Claude" },
    ]);
    await expect(client.getItems("7", "cursor / 1")).resolves.toEqual({
      items: [{ id: "9", status: "active", usageUsd: 1.25 }],
      nextCursor: "next-page",
    });
    await expect(client.getBatchSummary("7")).resolves.toEqual({
      total: 4,
      healthy: 3,
      usageUsd: 2.5,
    });
    await expect(client.getBatchNotes("7")).resolves.toEqual([
      { id: "2", message: "queued" },
    ]);

    expect(paths.slice(1)).toEqual([
      "/api/v1/supplier-portal/channels/",
      "/api/v1/supplier-portal/channels/7/items/?cursor=cursor+%2F+1",
      "/api/v1/supplier-portal/channels/7/batch-summary/",
      "/api/v1/supplier-portal/channels/7/batch-notes/",
    ]);
  });

  it.each([401, 403])(
    "renews once after an expired session response with status %s",
    async (status) => {
      let loginCount = 0;
      let channelCount = 0;
      const baseUrl = await startServer((request, response) => {
        if (request.url === "/api/v1/auth/login") {
          loginCount += 1;
          json(response, 200, { success: true }, {
            "set-cookie": [
              `sessionid=s${loginCount}; Path=/`,
              `csrftoken=c${loginCount}; Path=/`,
            ],
          });
          return;
        }
        channelCount += 1;
        if (channelCount === 1) {
          json(response, status, {
            code: status === 403 ? "session_expired" : "unauthorized",
          });
          return;
        }
        json(response, 200, [{ id: "channel-1", name: "Claude" }]);
      });
      const client = new SupplierPortalClient({
        baseUrl,
        username: "supplier",
        password: "password",
      });

      await client.login();
      await expect(client.getChannels()).resolves.toHaveLength(1);
      expect(loginCount).toBe(2);
      expect(channelCount).toBe(2);
    },
  );

  it("does not retry an unrecognized 403", async () => {
    let loginCount = 0;
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/api/v1/auth/login") {
        loginCount += 1;
        json(response, 200, { success: true }, {
          "set-cookie": ["sessionid=s; Path=/", "csrftoken=c; Path=/"],
        });
        return;
      }
      json(response, 403, { code: "permission_denied" });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier",
      password: "password",
    });
    await client.login();

    await expect(client.getChannels()).rejects.toMatchObject({
      name: "UpstreamHttpError",
      status: 403,
    });
    expect(loginCount).toBe(1);
  });

  it("retries an operation only once when the renewed session is also rejected", async () => {
    let loginCount = 0;
    let requestCount = 0;
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/api/v1/auth/login") {
        loginCount += 1;
        json(response, 200, { success: true }, {
          "set-cookie": ["sessionid=s; Path=/", "csrftoken=c; Path=/"],
        });
        return;
      }
      requestCount += 1;
      json(response, 401, { detail: "session expired" });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier",
      password: "password",
    });
    await client.login();

    await expect(client.getChannels()).rejects.toBeInstanceOf(UpstreamHttpError);
    expect(loginCount).toBe(2);
    expect(requestCount).toBe(2);
  });

  it("maps CAPTCHA challenges to a typed error", async () => {
    const baseUrl = await startServer((_request, response) => {
      json(response, 403, {
        captcha_required: true,
        detail: "Solve CAPTCHA using secret supplier password",
      });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier",
      password: "password",
    });

    await expect(client.login()).rejects.toEqual(
      expect.objectContaining({
        name: "CaptchaRequiredError",
        message: "Upstream login requires CAPTCHA",
      }),
    );
    await expect(client.login()).rejects.toBeInstanceOf(CaptchaRequiredError);
  });

  it("rejects incompatible responses with a typed contract error", async () => {
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/api/v1/auth/login") {
        json(response, 200, { success: true }, {
          "set-cookie": ["sessionid=s; Path=/", "csrftoken=c; Path=/"],
        });
        return;
      }
      json(response, 200, { results: [{ name: "missing id" }] });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier",
      password: "password",
    });
    await client.login();

    await expect(client.getChannels()).rejects.toEqual(
      expect.objectContaining({
        name: "UpstreamContractError",
        message: "Upstream response did not match the channels contract",
      }),
    );
    await expect(client.getChannels()).rejects.toBeInstanceOf(
      UpstreamContractError,
    );
  });

  it("rejects batch summaries without any recognized fields", async () => {
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/api/v1/auth/login") {
        json(response, 200, { success: true }, {
          "set-cookie": ["sessionid=s; Path=/", "csrftoken=c; Path=/"],
        });
        return;
      }
      json(response, 200, { unrelated: "shape" });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier",
      password: "password",
    });
    await client.login();

    await expect(client.getBatchSummary("7")).rejects.toBeInstanceOf(
      UpstreamContractError,
    );
  });

  it("bounds request duration and reports a sanitized timeout", async () => {
    const baseUrl = await startServer(async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      json(response, 200, { success: true }, {
        "set-cookie": ["sessionid=s; Path=/", "csrftoken=c; Path=/"],
      });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "secret-user",
      password: "secret-password",
      timeoutMs: 10,
    });

    const error = await client.login().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UpstreamHttpError);
    expect(error).toMatchObject({ code: "TIMEOUT", status: undefined });
    expect(String(error)).not.toContain("secret-user");
    expect(String(error)).not.toContain("secret-password");
  });

  it("never includes response secrets, cookies, CSRF, or Key-like values in errors", async () => {
    const exposed = [
      "supplier-password",
      "session-cookie-secret",
      "csrf-secret",
      "sk-ant-api03-never-expose",
    ];
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/api/v1/auth/login") {
        json(response, 200, { success: true }, {
          "set-cookie": [
            "sessionid=session-cookie-secret; Path=/",
            "csrftoken=csrf-secret; Path=/",
          ],
        });
        return;
      }
      json(response, 500, {
        password: "supplier-password",
        cookie: "session-cookie-secret",
        csrf: "csrf-secret",
        key: "sk-ant-api03-never-expose",
      });
    });
    const client = new SupplierPortalClient({
      baseUrl,
      username: "supplier-user",
      password: "supplier-password",
    });
    await client.login();

    const error = await client.getChannels().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UpstreamHttpError);
    expect(error).toMatchObject({ status: 500 });
    const serialized = JSON.stringify(error);
    for (const secret of exposed) {
      expect(String(error)).not.toContain(secret);
      expect(serialized).not.toContain(secret);
    }
  });
});
