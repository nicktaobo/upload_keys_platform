import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@keyhub/database";

import { processSubmitKey } from "./submit-key.js";
import {
  createWorkerRecord,
  encryptionKey,
  resetWorkerFixtures,
} from "../test/helpers.js";

describe("processSubmitKey", () => {
  beforeEach(resetWorkerFixtures);
  afterAll(async () => {
    await resetWorkerFixtures();
    await prisma.$disconnect();
  });

  it("submits the decrypted Key and stores the returned upstream item ID", async () => {
    const record = await createWorkerRecord("sk-ant-api03-worker-X7AA");
    const submitKeys = vi.fn().mockResolvedValue({ success: true, itemIds: ["item-101"] });

    await processSubmitKey(
      { keyRecordId: record.id },
      { client: { submitKeys }, encryptionKey },
    );

    expect(submitKeys).toHaveBeenCalledWith("channel-1", [
      { apiKey: "sk-ant-api03-worker-X7AA", warrantyHours: 24 },
    ]);
    await expect(prisma.keyRecord.findUniqueOrThrow({ where: { id: record.id } })).resolves.toMatchObject({
      status: "SUBMITTED",
      upstreamItemId: "item-101",
      failureCode: null,
    });
  });

  it("does not submit a record that is already mapped upstream", async () => {
    const record = await createWorkerRecord("sk-ant-api03-worker-X7AA", "item-existing");
    const submitKeys = vi.fn();

    await processSubmitKey(
      { keyRecordId: record.id },
      { client: { submitKeys }, encryptionKey },
    );

    expect(submitKeys).not.toHaveBeenCalled();
  });

  it("uses the currently configured channel when the pending record has no channel", async () => {
    const record = await createWorkerRecord("sk-ant-api03-worker-X7AA");
    await prisma.keyRecord.update({
      where: { id: record.id },
      data: { upstreamChannelId: null },
    });
    const submitKeys = vi.fn().mockResolvedValue({ success: true, itemIds: ["item-102"] });

    await processSubmitKey(
      { keyRecordId: record.id },
      { client: { submitKeys }, encryptionKey, channelId: "configured-channel" },
    );

    expect(submitKeys).toHaveBeenCalledWith("configured-channel", expect.any(Array));
  });

  it("records a sanitized failure and rethrows retryable errors", async () => {
    const record = await createWorkerRecord("sk-ant-api03-worker-X7AA");
    const submitKeys = vi.fn().mockRejectedValue(new Error("network failed for sk-ant-secret"));

    await expect(
      processSubmitKey(
        { keyRecordId: record.id },
        { client: { submitKeys }, encryptionKey },
      ),
    ).rejects.toThrow("Upstream submission failed");

    const failed = await prisma.keyRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(failed.status).toBe("RETRYING");
    expect(failed.failureMessage).toBe("上游提交暂时失败");
    expect(failed.failureMessage).not.toContain("sk-ant");
  });
});
