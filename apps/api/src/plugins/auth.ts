import { randomBytes } from "node:crypto";

import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

import { prisma, type UserRole } from "@keyhub/database";

declare module "fastify" {
  interface Session {
    userId?: string;
    role?: UserRole;
    sessionVersion?: number;
    csrfToken?: string;
  }

  interface FastifyRequest {
    currentUser?: {
      id: string;
      username: string;
      role: UserRole;
    };
  }

  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    verifyCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

export function createCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

export const authPlugin = fp(async (app) => {
  app.decorate(
    "authenticate",
    async function authenticate(request: FastifyRequest, reply: FastifyReply) {
      const { userId, sessionVersion } = request.session;
      if (!userId || !sessionVersion) {
        await reply.code(401).send({ message: "请先登录" });
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.isActive || user.sessionVersion !== sessionVersion) {
        await request.session.destroy();
        await reply.code(401).send({ message: "登录已失效" });
        return;
      }
      request.currentUser = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
    },
  );

  app.decorate(
    "requireAdmin",
    async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
      await app.authenticate(request, reply);
      if (reply.sent) return;
      if (request.currentUser?.role !== "ADMIN") {
        await reply.code(403).send({ message: "无权执行此操作" });
      }
    },
  );

  app.decorate(
    "verifyCsrf",
    async function verifyCsrf(request: FastifyRequest, reply: FastifyReply) {
      const token = request.headers["x-csrf-token"];
      if (!token || token !== request.session.csrfToken) {
        await reply.code(403).send({ message: "CSRF 校验失败" });
      }
    },
  );
});
