import { prisma } from "@keyhub/database";
import { decryptSecret } from "@keyhub/domain";
import type { SubmitKeyRow, UpstreamSubmissionResult } from "@keyhub/upstream";

export interface SubmitKeyClient {
  login(): Promise<void>;
  submitKeys(channelId: string, rows: SubmitKeyRow[]): Promise<UpstreamSubmissionResult>;
}

export interface SubmitKeyDependencies {
  client: SubmitKeyClient;
  encryptionKey: Buffer;
  channelId?: string;
}

export async function processSubmitKey(
  job: { keyRecordId: string; attemptsMade?: number; maxAttempts?: number },
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

  const claim = await prisma.keyRecord.updateMany({
    where: {
      id: record.id,
      upstreamItemId: null,
      status: { in: ["PENDING", "RETRYING", "UPSTREAM_ERROR"] },
    },
    data: { status: "SUBMITTING", failureCode: null, failureMessage: null },
  });
  if (claim.count !== 1) return;

  const run = await prisma.jobRun.create({
    data: { jobType: "submit-key", keyRecordId: record.id },
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
    await dependencies.client.login();
    const result = await dependencies.client.submitKeys(channelId, [
      { apiKey, warrantyHours: record.warrantyHours },
    ]);
    const upstreamItemId = result.itemIds[0];
    if (!result.success || !upstreamItemId) {
      const rejectionMessage = result.failureMessage ?? "Upstream rejected this Key";
      await prisma.$transaction([
        prisma.keyRecord.update({
          where: { id: record.id },
          data: {
            status: "TEST_FAILED",
            failureCode: "UPSTREAM_REJECTED",
            failureMessage: rejectionMessage,
          },
        }),
        prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            resultCode: "UPSTREAM_REJECTED",
            resultMessage: rejectionMessage,
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
    const isFinalAttempt = (job.attemptsMade ?? 0) + 1 >= (job.maxAttempts ?? 1);
    await prisma.$transaction([
      prisma.keyRecord.update({
        where: { id: record.id },
        data: {
          status: isFinalAttempt ? "UPSTREAM_ERROR" : "RETRYING",
          failureCode: isFinalAttempt ? "UPSTREAM_FAILURE" : "UPSTREAM_TEMPORARY_FAILURE",
          failureMessage: isFinalAttempt ? "上游提交失败" : "上游提交暂时失败",
        },
      }),
      prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          resultCode: isFinalAttempt ? "UPSTREAM_FAILURE" : "UPSTREAM_TEMPORARY_FAILURE",
          resultMessage: isFinalAttempt ? "上游提交失败" : "上游提交暂时失败",
          finishedAt: new Date(),
        },
      }),
    ]);
    throw new Error("Upstream submission failed");
  }
}
