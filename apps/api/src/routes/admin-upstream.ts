import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "@keyhub/database";
import { decryptSecret, encryptSecret } from "@keyhub/domain";
import type { createKeyHubQueues } from "@keyhub/queue";

import { loadKeySecrets } from "../services/keys.js";

type KeyHubQueues = ReturnType<typeof createKeyHubQueues>;
const credentialSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(512),
});

export async function adminUpstreamRoutes(
  app: FastifyInstance,
  queues: KeyHubQueues,
): Promise<void> {
  const { encryptionKey } = loadKeySecrets();
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async () => {
    const connection = await prisma.upstreamConnection.findUnique({
      where: { id: "primary" },
    });
    let username = "";
    if (
      connection?.encryptedUsername &&
      connection.usernameIv &&
      connection.usernameTag
    ) {
      username = decryptSecret(
        {
          ciphertext: connection.encryptedUsername,
          iv: connection.usernameIv,
          authTag: connection.usernameTag,
        },
        encryptionKey,
      );
    }
    const state = connection?.status === "CONNECTED"
      ? "connected"
      : connection?.status === "BLOCKED"
        ? "blocked"
        : "disconnected";
    return {
      state,
      username,
      failureMessage: connection?.failureMessage ?? null,
      lastLoginAt: connection?.lastLoginAt ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
    };
  });

  app.put(
    "/",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const parsed = credentialSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "上游账号信息无效" });
      const username = encryptSecret(parsed.data.username, encryptionKey);
      const password = encryptSecret(parsed.data.password, encryptionKey);
      await prisma.upstreamConnection.upsert({
        where: { id: "primary" },
        create: {
          id: "primary",
          encryptedUsername: username.ciphertext,
          usernameIv: username.iv,
          usernameTag: username.authTag,
          encryptedPassword: password.ciphertext,
          passwordIv: password.iv,
          passwordTag: password.authTag,
          status: "CONNECTING",
        },
        update: {
          encryptedUsername: username.ciphertext,
          usernameIv: username.iv,
          usernameTag: username.authTag,
          encryptedPassword: password.ciphertext,
          passwordIv: password.iv,
          passwordTag: password.authTag,
          status: "CONNECTING",
          failureCode: null,
          failureMessage: null,
        },
      });
      await queues.syncQueue.add(
        "connect-upstream",
        {},
        { jobId: `connect-${Date.now()}`, attempts: 1 },
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/sync",
    { preHandler: app.verifyCsrf },
    async (_request, reply) => {
      await queues.syncQueue.add(
        "sync-all",
        {},
        { jobId: `sync-all-${Date.now()}`, removeOnComplete: 50 },
      );
      return reply.code(202).send({ message: "同步任务已提交" });
    },
  );
}
