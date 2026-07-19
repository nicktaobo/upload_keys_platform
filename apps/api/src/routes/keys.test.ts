import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@keyhub/database";

import { buildApp } from "../app.js";
import { createUser, login, resetAuthFixtures } from "../test/helpers.js";

describe("owner-scoped Key API", () => {
  const app = buildApp();

  beforeAll(async () => app.ready());
  beforeEach(resetAuthFixtures);
  afterAll(async () => {
    await resetAuthFixtures();
    await app.close();
  });

  it("creates single and batch records and returns only masked values", async () => {
    const alice = await createUser({ username: "key-alice", password: "password-123" });
    const session = await login(app, alice.username, "password-123");

    const single = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
      payload: {
        mode: "single",
        apiKey: "sk-ant-api03-single-secret-X7AA",
        warrantyHours: 24,
      },
    });
    expect(single.statusCode).toBe(202);
    expect(single.body).not.toContain("single-secret");

    const batch = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
      payload: {
        mode: "batch",
        text: "sk-ant-api03-batch-one-M2PA, 48\nsk-ant-api03-batch-two-Q9BB 72",
      },
    });
    expect(batch.statusCode).toBe(202);
    expect(batch.json<{ created: unknown[] }>().created).toHaveLength(2);
    expect(await prisma.keyRecord.count({ where: { ownerId: alice.id } })).toBe(3);
  });

  it("rejects a globally duplicated Key without disclosing its owner", async () => {
    const alice = await createUser({ username: "key-alice", password: "password-123" });
    const bob = await createUser({ username: "key-bob", password: "password-123" });
    const aliceSession = await login(app, alice.username, "password-123");
    const bobSession = await login(app, bob.username, "password-123");
    const payload = {
      mode: "single",
      apiKey: "sk-ant-api03-shared-secret-X7AA",
      warrantyHours: 24,
    };

    await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie: aliceSession.cookie, "x-csrf-token": aliceSession.csrfToken },
      payload,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie: bobSession.cookie, "x-csrf-token": bobSession.csrfToken },
      payload,
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ message: "该 Key 已存在，无法重复提交" });
    expect(duplicate.body).not.toContain(alice.id);
  });

  it("lists and reveals only records owned by the current user", async () => {
    const alice = await createUser({ username: "key-alice", password: "password-123" });
    const bob = await createUser({ username: "key-bob", password: "password-123" });
    const aliceSession = await login(app, alice.username, "password-123");
    const bobSession = await login(app, bob.username, "password-123");
    const fullKey = "sk-ant-api03-owner-only-X7AA";

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie: aliceSession.cookie, "x-csrf-token": aliceSession.csrfToken },
      payload: { mode: "single", apiKey: fullKey, warrantyHours: 24 },
    });
    const recordId = createdResponse.json<{ created: Array<{ id: string }> }>().created[0]?.id;
    expect(recordId).toBeDefined();

    const bobList = await app.inject({
      method: "GET",
      url: "/api/keys",
      headers: { cookie: bobSession.cookie },
    });
    expect(bobList.json<{ items: unknown[] }>().items).toHaveLength(0);

    const denied = await app.inject({
      method: "POST",
      url: `/api/keys/${recordId}/reveal`,
      headers: { cookie: bobSession.cookie, "x-csrf-token": bobSession.csrfToken },
    });
    expect(denied.statusCode).toBe(404);

    const revealed = await app.inject({
      method: "POST",
      url: `/api/keys/${recordId}/reveal`,
      headers: { cookie: aliceSession.cookie, "x-csrf-token": aliceSession.csrfToken },
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json()).toEqual({ apiKey: fullKey });
  });

  it("returns row-specific batch validation issues", async () => {
    const alice = await createUser({ username: "key-alice", password: "password-123" });
    const session = await login(app, alice.username, "password-123");

    const response = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
      payload: { mode: "batch", text: "sk-ant-api03-bad-X7AA, zero" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "提交内容有误",
      issues: [{ row: 1, message: "质保期必须是 1 到 8760 之间的整数" }],
    });
  });
});
