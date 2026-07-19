import { hash } from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "@keyhub/database";

const createUserSchema = z.object({
  username: z.string().trim().min(2).max(80),
  password: z.string().min(12).max(256),
});
const passwordSchema = z.object({ password: z.string().min(12).max(256) });
const statusSchema = z.object({ isActive: z.boolean() });
const idParamsSchema = z.object({ id: z.string().min(1) });

const publicUserSelect = {
  id: true,
  username: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function adminUserRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async () =>
    prisma.user.findMany({ select: publicUserSelect, orderBy: { createdAt: "desc" } }),
  );

  app.post(
    "/",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "账号信息不符合要求" });
      const user = await prisma.user.create({
        data: {
          username: parsed.data.username,
          passwordHash: await hash(parsed.data.password, { type: 2 }),
        },
        select: publicUserSelect,
      });
      return reply.code(201).send(user);
    },
  );

  app.post(
    "/:id/reset-password",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const body = passwordSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ message: "密码不符合要求" });
      }
      await prisma.user.update({
        where: { id: params.data.id },
        data: {
          passwordHash: await hash(body.data.password, { type: 2 }),
          sessionVersion: { increment: 1 },
        },
      });
      return reply.code(204).send();
    },
  );

  app.post(
    "/:id/status",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const body = statusSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ message: "状态参数无效" });
      }
      await prisma.user.update({
        where: { id: params.data.id },
        data: {
          isActive: body.data.isActive,
          sessionVersion: { increment: 1 },
        },
      });
      return reply.code(204).send();
    },
  );
}
