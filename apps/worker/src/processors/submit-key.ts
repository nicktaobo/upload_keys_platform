import { prisma } from "@keyhub/database";
import { decryptSecret } from "@keyhub/domain";
import type { SubmitKeyRow, UpstreamSubmissionResult } from "@keyhub/upstream";

export interface SubmitKeyClient {
  submitKeys(channelId: string, rows: SubmitKeyRow[]): Promise<UpstreamSubmissionResult>;
}

export interface SubmitKeyDependencies {
  client: SubmitKeyClient;
  encryptionKey: Buffer;
  channelId?: string;
}

export async function processSubmitKey(
  job: { keyRecordId: string },
  dependencies: SubmitKeyDependencies,
): Promise<void> {
  const record = await prisma.keyRecord.findUnique({ where: { id: job.keyRecordId } });
  if (!record) return;
  if (record.upstreamItemId || record.status === "SUBMITTED") return;
  const channelId = record.upstreamChannelId ?? dependencies.channelId;
  if (!channelId) {
    await prisma.keyRecord.update({
      where: { id: record.id },
      data: {
        status: "UPSTREAM_ERROR",
        failureCode: "CHANNEL_UNAVAILABLE",
        failureMessage: "上游渠道尚未配置",
      },
    });
    return;
  }

  const run = await prisma.jobRun.create({
    data: { jobType: "submit-key", keyRecordId: record.id },
  });
  await prisma.keyRecord.update({
    where: { id: record.id },
    data: { status: "SUBMITTING", failureCode: null, failureMessage: null },
  });
  const apiKey = decryptSecret(
    {
      ciphertext: record.encryptedKey,
      iv: record.encryptionIv,
      authTag: record.encryptionTag,
    },
    dependencies.encryptionKey,
  );

  try {
    const result = await dependencies.client.submitKeys(channelId, [
      { apiKey, warrantyHours: record.warrantyHours },
    ]);
    const upstreamItemId = result.itemIds[0];
    if (!result.success || !upstreamItemId) {
      await prisma.$transaction([
        prisma.keyRecord.update({
          where: { id: record.id },
          data: {
            status: "TEST_FAILED",
            failureCode: "UPSTREAM_REJECTED",
            failureMessage: "上游未接受该 Key",
          },
        }),
        prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            resultCode: "UPSTREAM_REJECTED",
            resultMessage: "上游未接受该 Key",
            finishedAt: new Date(),
          },
        }),
      ]);
      return;
    }

    await prisma.$transaction([
      prisma.keyRecord.update({
        where: { id: record.id },
        data: {
          status: "SUBMITTED",
          upstreamItemId,
          submittedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      }),
      prisma.jobRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED", resultCode: "SUBMITTED", finishedAt: new Date() },
      }),
    ]);
  } catch {
    await prisma.$transaction([
      prisma.keyRecord.update({
        where: { id: record.id },
        data: {
          status: "RETRYING",
          failureCode: "UPSTREAM_TEMPORARY_FAILURE",
          failureMessage: "上游提交暂时失败",
        },
      }),
      prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          resultCode: "UPSTREAM_TEMPORARY_FAILURE",
          resultMessage: "上游提交暂时失败",
          finishedAt: new Date(),
        },
      }),
    ]);
    throw new Error("Upstream submission failed");
  }
}
