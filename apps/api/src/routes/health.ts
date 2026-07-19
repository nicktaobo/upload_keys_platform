import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";

import { prisma } from "@keyhub/database";

export async function healthRoutes(app: FastifyInstance, redis: Redis): Promise<void> {
  app.get("/live", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
      return { status: "ready", postgres: "ok", redis: "ok" };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
        postgres: "unknown",
        redis: "unknown",
      });
    }
  });
}
