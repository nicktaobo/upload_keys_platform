import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { createUser, login, resetAuthFixtures } from "../test/helpers.js";

describe("administrator user management", () => {
  const app = buildApp();

  beforeAll(async () => app.ready());
  beforeEach(resetAuthFixtures);
  afterAll(async () => {
    await resetAuthFixtures();
    await app.close();
  });

  it("allows only administrators to create users", async () => {
    await createUser({ username: "admin", password: "password-123", role: "ADMIN" });
    await createUser({ username: "alice", password: "password-123" });
    const admin = await login(app, "admin", "password-123");
    const user = await login(app, "alice", "password-123");

    const denied = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie: user.cookie, "x-csrf-token": user.csrfToken },
      payload: { username: "bob", password: "new-password-123" },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      payload: { username: "bob", password: "new-password-123" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ username: "bob", role: "USER", isActive: true });
    expect(created.body).not.toContain("passwordHash");
  });

  it("invalidates existing sessions when an administrator resets a password", async () => {
    const adminUser = await createUser({
      username: "admin",
      password: "password-123",
      role: "ADMIN",
    });
    const alice = await createUser({ username: "alice", password: "password-123" });
    const admin = await login(app, adminUser.username, "password-123");
    const oldSession = await login(app, alice.username, "password-123");

    const reset = await app.inject({
      method: "POST",
      url: `/api/admin/users/${alice.id}/reset-password`,
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      payload: { password: "replacement-123" },
    });
    expect(reset.statusCode).toBe(204);

    const stale = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: oldSession.cookie },
    });
    expect(stale.statusCode).toBe(401);
    await expect(login(app, "alice", "replacement-123")).resolves.toBeDefined();
  });

  it("disables a user and never returns password hashes in the user list", async () => {
    await createUser({ username: "admin", password: "password-123", role: "ADMIN" });
    const alice = await createUser({ username: "alice", password: "password-123" });
    const admin = await login(app, "admin", "password-123");
    const aliceSession = await login(app, "alice", "password-123");

    const disabled = await app.inject({
      method: "POST",
      url: `/api/admin/users/${alice.id}/status`,
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      payload: { isActive: false },
    });
    expect(disabled.statusCode).toBe(204);

    const stale = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: aliceSession.cookie },
    });
    expect(stale.statusCode).toBe(401);

    const users = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: admin.cookie },
    });
    expect(users.statusCode).toBe(200);
    expect(users.body).not.toContain("passwordHash");
    expect(users.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: "alice", isActive: false })]),
    );
  });
});
