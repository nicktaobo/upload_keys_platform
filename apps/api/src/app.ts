import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import session from "@fastify/session";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";

import { createKeyHubQueues } from "@keyhub/queue";

import { authPlugin } from "./plugins/auth.js";
import { RedisSessionStore } from "./plugins/redis-session-store.js";
import { adminKeyRoutes } from "./routes/admin-keys.js";
import { adminUpstreamRoutes } from "./routes/admin-upstream.js";
import { adminUserRoutes } from "./routes/admin-users.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { keyRoutes } from "./routes/keys.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const queues = createKeyHubQueues(process.env.REDIS_URL ?? "redis://localhost:6380");

  app.register(cookie);
  app.register(session, {
    secret:
      process.env.SESSION_SECRET ?? "development-session-secret-32chars",
    cookieName: "keyhub_session",
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
    saveUninitialized: false,
    rolling: true,
    store: new RedisSessionStore(redis),
  });
  app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  app.register(authPlugin);
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(adminUserRoutes, { prefix: "/api/admin/users" });
  app.register(async (instance) => adminKeyRoutes(instance, queues), {
    prefix: "/api/admin/keys",
  });
  app.register(async (instance) => adminUpstreamRoutes(instance, queues), {
    prefix: "/api/admin/upstream",
  });
  app.register(async (instance) => keyRoutes(instance, queues), { prefix: "/api/keys" });
  app.register(async (instance) => healthRoutes(instance, redis), { prefix: "/health" });

  app.addHook("onClose", async () => {
    await Promise.all([queues.submissionQueue.close(), queues.syncQueue.close()]);
    if (redis.status !== "end") await redis.quit();
  });

  return app;
}
