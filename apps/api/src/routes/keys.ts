import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma, type KeyStatus } from "@keyhub/database";
import { KeyInputError, parseBatch, type ParsedKeyRow } from "@keyhub/domain";
import type { createKeyHubQueues } from "@keyhub/queue";

import {
  createKeyRecords,
  DuplicateKeyError,
  loadKeySecrets,
  revealOwnedKey,
} from "../services/keys.js";

type KeyHubQueues = ReturnType<typeof createKeyHubQueues>;

const submitSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    apiKey: z.string().trim().min(8).max(512),
    warrantyHours: z.number().int().min(1).max(8760),
  }),
  z.object({ mode: z.literal("batch"), text: z.string().min(1).max(500_000) }),
]);
const idParamsSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(["PENDING", "SUBMITTING", "SUBMITTED", "TEST_FAILED", "RETRYING", "UPSTREAM_ERROR"])
    .optional(),
});

export async function keyRoutes(
  app: FastifyInstance,
  queues: KeyHubQueues,
): Promise<void> {
  const secrets = loadKeySecrets();
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "查询参数无效" });
    const ownerId = request.currentUser!.id;
    const where = { ownerId, ...(query.data.status ? { status: query.data.status as KeyStatus } : {}) };
    const [items, total] = await Promise.all([
      prisma.keyRecord.findMany({
        where,
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
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.data.page - 1) * query.data.pageSize,
        take: query.data.pageSize,
      }),
      prisma.keyRecord.count({ where }),
    ]);
    return { items, total, page: query.data.page, pageSize: query.data.pageSize };
  });

  app.get("/summary", async (request) => {
    const ownerId = request.currentUser!.id;
    const [count, healthy, usage, latest] = await Promise.all([
      prisma.keyRecord.count({ where: { ownerId } }),
      prisma.keyRecord.count({ where: { ownerId, accessStatus: "通过" } }),
      prisma.keyRecord.aggregate({ where: { ownerId }, _sum: { usageUsd: true } }),
      prisma.keyRecord.aggregate({ where: { ownerId }, _max: { sampledAt: true } }),
    ]);
    return {
      submittedCount: count,
      healthyCount: healthy,
      usageUsd: Number(usage._sum.usageUsd ?? 0),
      latestSampleAt: latest._max.sampledAt,
    };
  });

  app.post(
    "/",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const input = submitSchema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ message: "提交内容有误" });
      let rows: ParsedKeyRow[];
      try {
        rows =
          input.data.mode === "single"
            ? [{ apiKey: input.data.apiKey, warrantyHours: input.data.warrantyHours }]
            : parseBatch(input.data.text);
      } catch (error) {
        if (error instanceof KeyInputError) {
          return reply.code(400).send({ message: "提交内容有误", issues: error.issues });
        }
        throw error;
      }

      try {
        const created = await createKeyRecords(request.currentUser!.id, rows, secrets);
        if (process.env.UPSTREAM_ENABLED === "false") return reply.code(202).send({ created });
        const enqueueResults = await Promise.allSettled(
          created.map((record) =>
            queues.submissionQueue.add(
              "submit-key",
              { keyRecordId: record.id },
              { jobId: `submit-${record.id}`, attempts: 3, backoff: { type: "exponential", delay: 1000 } },
            ),
          ),
        );
        const failedRecordIds = enqueueResults.flatMap((result, index) =>
          result.status === "rejected" && created[index] ? [created[index].id] : [],
        );
        if (failedRecordIds.length > 0) {
          await prisma.keyRecord.updateMany({
            where: { id: { in: failedRecordIds } },
            data: {
              status: "UPSTREAM_ERROR",
              failureCode: "SUBMISSION_QUEUE_UNAVAILABLE",
              failureMessage: "提交任务未能加入队列，请由管理员重试",
            },
          });
          return reply.code(503).send({ message: "提交任务暂时不可用，请联系管理员重试" });
        }
        return reply.code(202).send({ created });
      } catch (error) {
        if (error instanceof DuplicateKeyError) {
          return reply.code(409).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/:id/retry",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ message: "记录不存在" });
      const record = await prisma.keyRecord.findFirst({
        where: { id: params.data.id, ownerId: request.currentUser!.id },
      });
      if (!record) return reply.code(404).send({ message: "记录不存在" });
      const retry = await prisma.keyRecord.updateMany({
        where: {
          id: record.id,
          ownerId: request.currentUser!.id,
          status: { in: ["TEST_FAILED", "UPSTREAM_ERROR"] },
        },
        data: { status: "RETRYING", failureCode: null, failureMessage: null },
      });
      if (retry.count !== 1) return reply.code(409).send({ message: "当前状态不可重试" });
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

  app.post(
    "/:id/reveal",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ message: "记录不存在" });
      const apiKey = await revealOwnedKey(
        request.currentUser!.id,
        params.data.id,
        secrets.encryptionKey,
      );
      if (!apiKey) return reply.code(404).send({ message: "记录不存在" });
      return { apiKey };
    },
  );

  app.post(
    "/refresh",
    {
      preHandler: app.verifyCsrf,
      config: {
        rateLimit: {
          max: 1,
          timeWindow: "1 minute",
          groupId: "manual-refresh",
          keyGenerator: (request) => request.session.userId ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const ownerId = request.currentUser!.id;
      await queues.syncQueue.add(
        "sync-owner",
        { ownerId, requestedBy: ownerId },
        { removeOnComplete: 50 },
      );
      return reply.code(202).send({ message: "同步任务已提交" });
    },
  );
}
