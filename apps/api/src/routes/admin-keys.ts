import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "@keyhub/database";
import type { createKeyHubQueues } from "@keyhub/queue";

type KeyHubQueues = ReturnType<typeof createKeyHubQueues>;
const idParamsSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  ownerId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "SUBMITTING", "SUBMITTED", "TEST_FAILED", "RETRYING", "UPSTREAM_ERROR"]).optional(),
});

export async function adminKeyRoutes(
  app: FastifyInstance,
  queues: KeyHubQueues,
): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.get("/", async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "查询参数无效" });
    const where = {
      ...(query.data.ownerId ? { ownerId: query.data.ownerId } : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
    };
    const usersPromise = prisma.user.findMany({
      where: { role: "USER", keys: { some: {} } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
    const groupedPromise = prisma.keyRecord.groupBy({
      by: ["ownerId"],
      where,
      _count: { _all: true },
      _sum: { usageUsd: true },
    });
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
          owner: { select: { id: true, username: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.data.page - 1) * query.data.pageSize,
        take: query.data.pageSize,
      }),
      prisma.keyRecord.count({ where }),
    ]);
    const [groups, users] = await Promise.all([groupedPromise, usersPromise]);
    const healthyGroups = await prisma.keyRecord.groupBy({
      by: ["ownerId"],
      where: { ...where, accessStatus: "通过" },
      _count: { _all: true },
    });
    const healthyByOwner = new Map(healthyGroups.map((group) => [group.ownerId, group._count._all]));
    const usernameById = new Map(users.map((user) => [user.id, user.username]));
    const stats = groups
      .map((group) => ({
        ownerId: group.ownerId,
        username: usernameById.get(group.ownerId) ?? group.ownerId,
        keyCount: group._count._all,
        healthyCount: healthyByOwner.get(group.ownerId) ?? 0,
        usageUsd: Number(group._sum.usageUsd ?? 0),
      }))
      .sort((left, right) => left.username.localeCompare(right.username));
    return { items, total, page: query.data.page, pageSize: query.data.pageSize, owners: users, stats };
  });

  app.post(
    "/:id/retry",
    { preHandler: app.verifyCsrf },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ message: "记录不存在" });
      const record = await prisma.keyRecord.findUnique({ where: { id: params.data.id } });
      if (!record) return reply.code(404).send({ message: "记录不存在" });
      const retry = await prisma.keyRecord.updateMany({
        where: {
          id: record.id,
          status: { in: ["TEST_FAILED", "UPSTREAM_ERROR"] },
        },
        data: { status: "RETRYING", failureCode: null, failureMessage: null },
      });
      if (retry.count !== 1) {
        return reply.code(409).send({ message: "当前状态不可重试" });
      }
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
