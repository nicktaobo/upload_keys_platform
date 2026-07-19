import { hash } from "argon2";
import type { FastifyInstance } from "fastify";

import { prisma } from "@keyhub/database";

export async function resetAuthFixtures(): Promise<void> {
  await prisma.keyRecord.deleteMany();
  await prisma.user.deleteMany();
}

export async function createUser(input: {
  username: string;
  password: string;
  role?: "ADMIN" | "USER";
  isActive?: boolean;
}) {
  return prisma.user.create({
    data: {
      username: input.username,
      passwordHash: await hash(input.password, { type: 2 }),
      role: input.role ?? "USER",
      isActive: input.isActive ?? true,
    },
  });
}

export async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<{ cookie: string; csrfToken: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  const body = response.json<{ csrfToken: string }>();
  const setCookie = response.headers["set-cookie"];
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!rawCookie) throw new Error("Login did not set a session cookie");
  return { cookie: rawCookie.split(";")[0] ?? "", csrfToken: body.csrfToken };
}
