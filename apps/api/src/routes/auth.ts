import { verify } from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "@keyhub/database";

import { createCsrfToken } from "../plugins/auth.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(256),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "请输入用户名和密码" });

    const user = await prisma.user.findUnique({
      where: { username: parsed.data.username },
    });
    const valid = user ? await verify(user.passwordHash, parsed.data.password) : false;
    if (!user || !user.isActive || !valid) {
      return reply.code(401).send({ message: "用户名或密码错误" });
    }

    const csrfToken = createCsrfToken();
    request.session.userId = user.id;
    request.session.role = user.role;
    request.session.sessionVersion = user.sessionVersion;
    request.session.csrfToken = csrfToken;
    await request.session.save();

    return reply.send({
      user: { id: user.id, username: user.username, role: user.role },
      csrfToken,
    });
  });

  app.get("/me", { preHandler: app.authenticate }, async (request) => ({
    user: request.currentUser,
    csrfToken: request.session.csrfToken,
  }));

  app.post(
    "/logout",
    { preHandler: [app.authenticate, app.verifyCsrf] },
    async (request, reply) => {
      await request.session.destroy();
      return reply.code(204).send();
    },
  );
}
