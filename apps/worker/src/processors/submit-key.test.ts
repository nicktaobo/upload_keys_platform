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
      { client: { login: vi.fn(), submitKeys }, encryptionKey },
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

  it("logs in before submitting with a newly created client", async () => {
    const record = await createWorkerRecord("sk-ant-api03-login-X7AA");
    let authenticated = false;
    const login = vi.fn().mockImplementation(async () => {
      authenticated = true;
    });
    const submitKeys = vi.fn().mockImplementation(async () => {
      if (!authenticated) throw new Error("missing CSRF session");
      return { success: true, itemIds: ["item-login"] };
    });

    await processSubmitKey(
      { keyRecordId: record.id },
      { client: { login, submitKeys }, encryptionKey },
    );

    expect(login).toHaveBeenCalledOnce();
    expect(login.mock.invocationCallOrder[0]).toBeLessThan(
      submitKeys.mock.invocationCallOrder[0]!,
    );
  });

  it("does not submit a record that is already mapped upstream", async () => {
    const record = await createWorkerRecord("sk-ant-api03-worker-X7AA", "item-existing");
    const submitKeys = vi.fn();

    await processSubmitKey(
      { keyRecordId: record.id },
      { client: { login: vi.fn(), submitKeys }, encryptionKey },
    );

    expect(submitKeys).not.toHaveBeenCalled();
  });

  it("allows only one concurrent processor to claim a record", async () => {
    const record = await createWorkerRecord("sk-ant-api03-concurrent-X7AA");
    let releaseFirstSubmission!: () => void;
    const firstSubmissionGate = new Promise<void>((resolve) => {
      releaseFirstSubmission = resolve;
    });
    let firstSubmissionStarted!: () => void;
    const firstSubmissionStart = new Promise<void>((resolve) => {
      firstSubmissionStarted = resolve;
    });
    const submitKeys = vi.fn().mockImplementation(async () => {
      if (submitKeys.mock.calls.length === 1) {
        firstSubmissionStarted();
        await firstSubmissionGate;
      }
      return { success: true, itemIds: ["item-concurrent"] };
    });
    const dependencies = {
      client: { login: vi.fn(), submitKeys },
      encryptionKey,
    };

    const first = processSubmitKey({ keyRecordId: record.id }, dependencies);
    await firstSubmissionStart;
    const second = processSubmitKey({ keyRecordId: record.id }, dependencies);
    await second;
    releaseFirstSubmission();
    await Promise.all([first, second]);

    expect(dependencies.client.login).toHaveBeenCalledOnce();
    expect(submitKeys).toHaveBeenCalledOnce();
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
      {
        client: { login: vi.fn(), submitKeys },
        encryptionKey,
        channelId: "configured-channel",
      },
    );

    expect(submitKeys).toHaveBeenCalledWith("configured-channel", expect.any(Array));
  });

  it("records a sanitized retrying failure before the final attempt", async () => {
    const record = await createWorkerRecord("sk-ant-api03-worker-X7AA");
    const submitKeys = vi.fn().mockRejectedValue(new Error("network failed for sk-ant-secret"));

    await expect(
      processSubmitKey(
        { keyRecordId: record.id, attemptsMade: 0, maxAttempts: 3 },
        { client: { login: vi.fn(), submitKeys }, encryptionKey },
      ),
    ).rejects.toThrow("Upstream submission failed");

    const failed = await prisma.keyRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(failed.status).toBe("RETRYING");
    expect(failed.failureCode).toBe("UPSTREAM_TEMPORARY_FAILURE");
    expect(failed.failureMessage).toBe("上游提交暂时失败");
    expect(failed.failureMessage).not.toContain("sk-ant");
  });

  it("records a sanitized permanent failure on the final attempt", async () => {
    const record = await createWorkerRecord("sk-ant-api03-final-X7AA");
    const submitKeys = vi.fn().mockRejectedValue(new Error("network failed for sk-ant-secret"));

    await expect(
      processSubmitKey(
        { keyRecordId: record.id, attemptsMade: 2, maxAttempts: 3 },
        { client: { login: vi.fn(), submitKeys }, encryptionKey },
      ),
    ).rejects.toThrow("Upstream submission failed");

    const failed = await prisma.keyRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(failed.status).toBe("UPSTREAM_ERROR");
    expect(failed.failureCode).toBe("UPSTREAM_FAILURE");
    expect(failed.failureMessage).toBe("上游提交失败");
    expect(failed.failureMessage).not.toContain("sk-ant");
  });
});
