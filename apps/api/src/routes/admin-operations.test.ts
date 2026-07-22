import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@keyhub/database";
import { createKeyHubQueues } from "@keyhub/queue";

import { buildApp } from "../app.js";
import { createKeyRecords, loadKeySecrets } from "../services/keys.js";
import { createUser, login, resetAuthFixtures } from "../test/helpers.js";

describe("administrator operations", () => {
  const app = buildApp();

  beforeAll(async () => app.ready());
  beforeEach(async () => {
    await resetAuthFixtures();
    await prisma.jobRun.deleteMany();
    await prisma.upstreamConnection.deleteMany();
  });
  afterAll(async () => {
    await resetAuthFixtures();
    await prisma.jobRun.deleteMany();
    await prisma.upstreamConnection.deleteMany();
    await app.close();
  });

  it("lists all records for administrators without exposing full Keys", async () => {
    const admin = await createUser({ username: "ops-admin", password: "password-123", role: "ADMIN" });
    const alice = await createUser({ username: "ops-alice", password: "password-123" });
    const session = await login(app, admin.username, "password-123");
    await createKeyRecords(
      alice.id,
      [{ apiKey: "sk-ant-api03-admin-hidden-X7AA", warrantyHours: 24 }],
      loadKeySecrets(),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/keys",
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [
        {
          maskedKey: "sk-ant-****X7AA",
          owner: { id: alice.id, username: alice.username },
        },
      ],
    });
    expect(response.body).not.toContain("admin-hidden");
    expect(response.body).not.toContain("encryptedKey");
  });

  it("paginates administrator Key records", async () => {
    const admin = await createUser({ username: "page-admin", password: "password-123", role: "ADMIN" });
    const alice = await createUser({ username: "page-alice", password: "password-123" });
    const session = await login(app, admin.username, "password-123");
    const records = await createKeyRecords(
      alice.id,
      [
        { apiKey: "sk-ant-api03-admin-page-A1AA", warrantyHours: 24 },
        { apiKey: "sk-ant-api03-admin-page-B2BB", warrantyHours: 24 },
        { apiKey: "sk-ant-api03-admin-page-C3CC", warrantyHours: 24 },
      ],
      loadKeySecrets(),
    );
    await Promise.all(
      records.map((record, index) =>
        prisma.keyRecord.update({
          where: { id: record.id },
          data: { createdAt: new Date(Date.UTC(2026, 0, index + 1)) },
        }),
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/keys?page=2&pageSize=1",
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: records[1]!.id }],
      total: 3,
      page: 2,
      pageSize: 1,
    });
  });

  it("filters administrator Keys and returns owner statistics", async () => {
    const admin = await createUser({ username: "stats-admin", password: "password-123", role: "ADMIN" });
    const alice = await createUser({ username: "stats-alice", password: "password-123" });
    const bob = await createUser({ username: "stats-bob", password: "password-123" });
    const session = await login(app, admin.username, "password-123");
    const aliceRecords = await createKeyRecords(alice.id, [
      { apiKey: "sk-ant-api03-stats-alice-A1AA", warrantyHours: 1 },
      { apiKey: "sk-ant-api03-stats-alice-B2BB", warrantyHours: 1 },
    ], loadKeySecrets());
    const [bobRecord] = await createKeyRecords(bob.id, [
      { apiKey: "sk-ant-api03-stats-bob-C3CC", warrantyHours: 1 },
    ], loadKeySecrets());
    await prisma.keyRecord.update({ where: { id: aliceRecords[0]!.id }, data: { accessStatus: "通过", usageUsd: 12.5 } });
    await prisma.keyRecord.update({ where: { id: aliceRecords[1]!.id }, data: { status: "UPSTREAM_ERROR", usageUsd: 3.25 } });
    await prisma.keyRecord.update({ where: { id: bobRecord!.id }, data: { accessStatus: "通过", usageUsd: 7 } });

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/keys?ownerId=${alice.id}&status=UPSTREAM_ERROR`,
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [{ owner: { id: alice.id }, status: "UPSTREAM_ERROR" }],
      stats: [{ ownerId: alice.id, username: alice.username, keyCount: 1, healthyCount: 0, usageUsd: 3.25 }],
    });
  });

  it("orders administrator records with equal creation times by id descending", async () => {
    const admin = await createUser({ username: "stable-admin", password: "password-123", role: "ADMIN" });
    const alice = await createUser({ username: "stable-owner", password: "password-123" });
    const session = await login(app, admin.username, "password-123");
    const records = await createKeyRecords(
      alice.id,
      [
        { apiKey: "sk-ant-api03-admin-stable-A1AA", warrantyHours: 24 },
        { apiKey: "sk-ant-api03-admin-stable-B2BB", warrantyHours: 24 },
        { apiKey: "sk-ant-api03-admin-stable-C3CC", warrantyHours: 24 },
      ],
      loadKeySecrets(),
    );
    const createdAt = new Date("2026-07-19T12:00:00.000Z");
    await prisma.keyRecord.updateMany({
      where: { id: { in: records.map(({ id }) => id) } },
      data: { createdAt },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/keys?pageSize=3",
      headers: { cookie: session.cookie },
    });

    const expectedIds = records.map(({ id }) => id).sort((left, right) => right.localeCompare(left));
    expect(response.json<{ items: Array<{ id: string }> }>().items.map(({ id }) => id)).toEqual(expectedIds);
  });

  it("rejects administrator Key page sizes above 100", async () => {
    const admin = await createUser({ username: "page-limit-admin", password: "password-123", role: "ADMIN" });
    const session = await login(app, admin.username, "password-123");

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/keys?pageSize=101",
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it("denies ordinary users and queues an administrator retry", async () => {
    const admin = await createUser({ username: "ops-admin", password: "password-123", role: "ADMIN" });
    const alice = await createUser({ username: "ops-alice", password: "password-123" });
    const adminSession = await login(app, admin.username, "password-123");
    const userSession = await login(app, alice.username, "password-123");
    const [record] = await createKeyRecords(
      alice.id,
      [{ apiKey: "sk-ant-api03-retry-X7AA", warrantyHours: 24 }],
      loadKeySecrets(),
    );
    await prisma.keyRecord.update({
      where: { id: record!.id },
      data: { status: "TEST_FAILED" },
    });

    const denied = await app.inject({
      method: "POST",
      url: `/api/admin/keys/${record!.id}/retry`,
      headers: { cookie: userSession.cookie, "x-csrf-token": userSession.csrfToken },
    });
    expect(denied.statusCode).toBe(403);

    const retry = await app.inject({
      method: "POST",
      url: `/api/admin/keys/${record!.id}/retry`,
      headers: { cookie: adminSession.cookie, "x-csrf-token": adminSession.csrfToken },
    });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toEqual({ message: "重试任务已提交" });
    await expect(prisma.keyRecord.findUniqueOrThrow({ where: { id: record!.id } })).resolves.toMatchObject({
      status: "RETRYING",
    });
  });

  it("does not retry a Key that has already been submitted", async () => {
    const admin = await createUser({ username: "submitted-admin", password: "password-123", role: "ADMIN" });
    const alice = await createUser({ username: "submitted-alice", password: "password-123" });
    const session = await login(app, admin.username, "password-123");
    const [record] = await createKeyRecords(
      alice.id,
      [{ apiKey: "sk-ant-api03-submitted-X7AA", warrantyHours: 24 }],
      loadKeySecrets(),
    );
    await prisma.keyRecord.update({
      where: { id: record!.id },
      data: { status: "SUBMITTED", upstreamItemId: "item-submitted" },
    });
    const testQueues = createKeyHubQueues(process.env.REDIS_URL ?? "redis://localhost:6380");
    const add = vi.spyOn(Object.getPrototypeOf(testQueues.submissionQueue), "add");

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/admin/keys/${record!.id}/retry`,
        headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "当前状态不可重试" });
      expect(add).not.toHaveBeenCalled();
      await expect(prisma.keyRecord.findUniqueOrThrow({ where: { id: record!.id } })).resolves.toMatchObject({
        status: "SUBMITTED",
        upstreamItemId: "item-submitted",
      });
    } finally {
      add.mockRestore();
      await Promise.all([testQueues.submissionQueue.close(), testQueues.syncQueue.close()]);
    }
  });

  it("encrypts upstream credentials and queues connection and sync jobs", async () => {
    const admin = await createUser({ username: "ops-admin", password: "password-123", role: "ADMIN" });
    const session = await login(app, admin.username, "password-123");

    const saved = await app.inject({
      method: "PUT",
      url: "/api/admin/upstream",
      headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
      payload: { username: "supplier-user", password: "supplier-password" },
    });
    expect(saved.statusCode).toBe(204);
    const connection = await prisma.upstreamConnection.findUniqueOrThrow({
      where: { id: "primary" },
    });
    expect(connection.encryptedUsername).not.toContain("supplier-user");
    expect(connection.encryptedPassword).not.toContain("supplier-password");
    expect(connection.status).toBe("CONNECTING");

    const sync = await app.inject({
      method: "POST",
      url: "/api/admin/upstream/sync",
      headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
    });
    expect(sync.statusCode).toBe(202);
    expect(sync.json()).toEqual({ message: "同步任务已提交" });
  });
});

describe("health endpoints", () => {
  const app = buildApp();
  beforeAll(async () => app.ready());
  afterAll(async () => app.close());

  it("reports liveness and dependency readiness separately", async () => {
    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready", postgres: "ok", redis: "ok" });
  });
});
