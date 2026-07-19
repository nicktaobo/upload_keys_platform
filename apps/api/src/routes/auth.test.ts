import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@keyhub/database";

import { buildApp } from "../app.js";
import { createUser, login, resetAuthFixtures } from "../test/helpers.js";

describe("authentication", () => {
  const app = buildApp();

  beforeAll(async () => app.ready());
  beforeEach(resetAuthFixtures);
  afterAll(async () => {
    await resetAuthFixtures();
    await app.close();
    await prisma.$disconnect();
  });

  it("creates an HttpOnly strict session for valid credentials", async () => {
    await createUser({ username: "alice", password: "password-123" });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "password-123" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.json()).toMatchObject({
      user: { username: "alice", role: "USER" },
      csrfToken: expect.any(String),
    });
  });

  it("rejects invalid credentials and inactive users", async () => {
    await createUser({
      username: "disabled",
      password: "password-123",
      isActive: false,
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "disabled", password: "wrong-password" },
    });
    const disabled = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "disabled", password: "password-123" },
    });

    expect(invalid.statusCode).toBe(401);
    expect(disabled.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ message: "用户名或密码错误" });
    expect(disabled.json()).toEqual({ message: "用户名或密码错误" });
  });

  it("returns the current user and invalidates the session on logout", async () => {
    await createUser({ username: "alice", password: "password-123" });
    const session = await login(app, "alice", "password-123");

    const current = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: session.cookie },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      user: { username: "alice", role: "USER" },
    });

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: session.cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
