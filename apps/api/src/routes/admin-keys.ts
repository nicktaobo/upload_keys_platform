import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "@keyhub/database";
import type { createKeyHubQueues } from "@keyhub/queue";

type KeyHubQueues = ReturnType<typeof createKeyHubQueues>;
const idParamsSchema = z.object({ id: z.string().min(1) });

export async function adminKeyRoutes(
  app: FastifyInstance,
  queues: KeyHubQueues,
): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async () => {
    const [items, total] = await Promise.all([
      prisma.keyRecord.findMany({
        select: {
          id: true,
          maskedKey: true,
          warrantyHours: true,
          status: true,
          testResult: true,
          accessStatus: true,
          usageUsd: true,
          usageSiteCount: true,
          sampledAt: true,
          submittedAt: true,
          failureCode: true,
          failureMessage: true,
          createdAt: true,
          owner: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.keyRecord.count(),
    ]);
    return { items, total };
  });

  app.post(
    "/:id/retry",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ message: "记录不存在" });
      const record = await prisma.keyRecord.findUnique({ where: { id: params.data.id } });
      if (!record) return reply.code(404).send({ message: "记录不存在" });
      await prisma.keyRecord.update({
        where: { id: record.id },
        data: { status: "RETRYING", failureCode: null, failureMessage: null },
      });
      await queues.submissionQueue.add(
        "submit-key",
        { keyRecordId: record.id },
        {
          jobId: `retry-${record.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
        },
      );
      return reply.code(202).send({ message: "重试任务已提交" });
    },
  );
}
