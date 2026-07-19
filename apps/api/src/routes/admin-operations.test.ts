import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@keyhub/database";

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
