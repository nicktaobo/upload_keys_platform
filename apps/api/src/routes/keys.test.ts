import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@keyhub/database";
import { createKeyHubQueues } from "@keyhub/queue";

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

  it("marks only records whose submission jobs fail to enqueue as retryable", async () => {
    const alice = await createUser({ username: "queue-alice", password: "password-123" });
    const session = await login(app, alice.username, "password-123");
    const queueError = "Redis connection refused at redis://internal:6379";
    const testQueues = createKeyHubQueues(process.env.REDIS_URL ?? "redis://localhost:6380");
    const add = vi
      .spyOn(Object.getPrototypeOf(testQueues.submissionQueue), "add")
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error(queueError));

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/keys",
        headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
        payload: {
          mode: "batch",
          text: "sk-ant-api03-queued-ok-X7AA, 24\nsk-ant-api03-queue-failed-Q9BB, 48",
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ message: "提交任务暂时不可用，请联系管理员重试" });
      expect(response.body).not.toContain("sk-ant-api03");
      expect(response.body).not.toContain("internal:6379");

      const records = await prisma.keyRecord.findMany({
        where: { ownerId: alice.id },
        orderBy: { warrantyHours: "asc" },
      });
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        warrantyHours: 24,
        status: "PENDING",
        failureCode: null,
        failureMessage: null,
      });
      expect(records[1]).toMatchObject({
        warrantyHours: 48,
        status: "UPSTREAM_ERROR",
        failureCode: "SUBMISSION_QUEUE_UNAVAILABLE",
        failureMessage: "提交任务未能加入队列，请由管理员重试",
      });
      expect(records[1]?.failureMessage).not.toContain("sk-ant-api03");
      expect(records[1]?.failureMessage).not.toContain("internal:6379");
    } finally {
      add.mockRestore();
      await Promise.all([testQueues.submissionQueue.close(), testQueues.syncQueue.close()]);
    }
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

  it("orders records with equal creation times by id descending", async () => {
    const alice = await createUser({ username: "stable-order-alice", password: "password-123" });
    const session = await login(app, alice.username, "password-123");
    const createdAt = new Date("2026-07-19T12:00:00.000Z");
    const records = await Promise.all(
      ["A1AA", "B2BB", "C3CC"].map(async (suffix) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/keys",
          headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
          payload: {
            mode: "single",
            apiKey: `sk-ant-api03-stable-order-${suffix}`,
            warrantyHours: 24,
          },
        });
        const record = response.json<{ created: Array<{ id: string }> }>().created[0]!;
        await prisma.keyRecord.update({ where: { id: record.id }, data: { createdAt } });
        return record;
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/keys?pageSize=3",
      headers: { cookie: session.cookie },
    });

    const expectedIds = records.map(({ id }) => id).sort((left, right) => right.localeCompare(left));
    expect(response.json<{ items: Array<{ id: string }> }>().items.map(({ id }) => id)).toEqual(expectedIds);
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

  it("rate limits manual refresh per user without affecting other users", async () => {
    const alice = await createUser({ username: "refresh-alice", password: "password-123" });
    const bob = await createUser({ username: "refresh-bob", password: "password-123" });
    const aliceSession = await login(app, alice.username, "password-123");
    const bobSession = await login(app, bob.username, "password-123");
    const testQueues = createKeyHubQueues(process.env.REDIS_URL ?? "redis://localhost:6380");
    const add = vi
      .spyOn(Object.getPrototypeOf(testQueues.submissionQueue), "add")
      .mockResolvedValue({} as never);

    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/keys/refresh",
        headers: {
          cookie: aliceSession.cookie,
          "x-csrf-token": aliceSession.csrfToken,
        },
      });
      const limited = await app.inject({
        method: "POST",
        url: "/api/keys/refresh",
        headers: {
          cookie: aliceSession.cookie,
          "x-csrf-token": aliceSession.csrfToken,
        },
      });
      const otherUser = await app.inject({
        method: "POST",
        url: "/api/keys/refresh",
        headers: { cookie: bobSession.cookie, "x-csrf-token": bobSession.csrfToken },
      });

      expect(first.statusCode).toBe(202);
      expect(limited.statusCode).toBe(429);
      expect(otherUser.statusCode).toBe(202);
      expect(add).toHaveBeenCalledTimes(2);
      expect(add).toHaveBeenNthCalledWith(
        1,
        "sync-owner",
        { ownerId: alice.id, requestedBy: alice.id },
        { removeOnComplete: 50 },
      );
      expect(add).toHaveBeenNthCalledWith(
        2,
        "sync-owner",
        { ownerId: bob.id, requestedBy: bob.id },
        { removeOnComplete: 50 },
      );
    } finally {
      add.mockRestore();
      await Promise.all([testQueues.submissionQueue.close(), testQueues.syncQueue.close()]);
    }
  });
});
