import { prisma } from "@keyhub/database";
import type { UpstreamItemsPage } from "@keyhub/upstream";

export interface SyncClient {
  login(): Promise<void>;
  getItems(channelId: string, cursor?: string): Promise<UpstreamItemsPage>;
}

export interface SyncDependencies {
  client: SyncClient;
  channelId: string;
}

export async function processSyncKeys(
  job: { ownerId?: string },
  dependencies: SyncDependencies,
): Promise<{ updated: number }> {
  await dependencies.client.login();
  const upstreamItems: UpstreamItemsPage["items"] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await dependencies.client.getItems(dependencies.channelId, cursor);
    upstreamItems.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const byId = new Map(upstreamItems.map((item) => [item.id, item]));
  const mappedIds = [...byId.keys()];
  if (mappedIds.length === 0) return { updated: 0 };
  const records = await prisma.keyRecord.findMany({
    where: {
      upstreamItemId: { in: mappedIds },
      ...(job.ownerId ? { ownerId: job.ownerId } : {}),
    },
    select: { id: true, upstreamItemId: true },
  });

  await prisma.$transaction(
    records.map((record) => {
      const item = byId.get(record.upstreamItemId!);
      const sampledAt = item?.sampledAt ? new Date(item.sampledAt) : undefined;
      return prisma.keyRecord.update({
        where: { id: record.id },
        data: {
          status: "SUBMITTED",
          accessStatus: item?.status,
          usageUsd: item?.usageUsd,
          usageSiteCount: item?.usageSiteCount,
          sampledAt:
            sampledAt && !Number.isNaN(sampledAt.getTime()) ? sampledAt : undefined,
        },
      });
    }),
  );
  await prisma.upstreamConnection.upsert({
    where: { id: "primary" },
    create: {
      id: "primary",
      upstreamChannelId: dependencies.channelId,
      status: "CONNECTED",
      lastSyncAt: new Date(),
      lastSuccessAt: new Date(),
    },
    update: {
      status: "CONNECTED",
      lastSyncAt: new Date(),
      lastSuccessAt: new Date(),
      failureCode: null,
      failureMessage: null,
    },
  });

  return { updated: records.length };
}
