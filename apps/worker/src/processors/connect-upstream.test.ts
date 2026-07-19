import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@keyhub/database";
import { encryptSecret } from "@keyhub/domain";

import {
  loadUpstreamCredentials,
  prepareEnvironmentConnection,
  processConnectUpstream,
} from "./connect-upstream.js";
import {
  createWorkerRecord,
  encryptionKey,
  resetWorkerFixtures,
} from "../test/helpers.js";

describe("processConnectUpstream", () => {
  beforeEach(resetWorkerFixtures);
  afterAll(async () => {
    await resetWorkerFixtures();
    await prisma.$disconnect();
  });

  it("decrypts credentials, logs in, and selects the fixed Claude channel", async () => {
    const username = encryptSecret("supplier-user", encryptionKey);
    const password = encryptSecret("supplier-password", encryptionKey);
    await prisma.upstreamConnection.create({
      data: {
        id: "primary",
        encryptedUsername: username.ciphertext,
        usernameIv: username.iv,
        usernameTag: username.authTag,
        encryptedPassword: password.ciphertext,
        passwordIv: password.iv,
        passwordTag: password.authTag,
      },
    });
    const login = vi.fn().mockResolvedValue(undefined);
    const getChannels = vi.fn().mockResolvedValue([
      { id: "other", name: "Other" },
      { id: "claude-1", name: "ModelBoxs-Claude-按量（Claude 官方）" },
    ]);
    const factory = vi.fn().mockReturnValue({ login, getChannels });

    await processConnectUpstream({
      encryptionKey,
      baseUrl: "https://example.test",
      factory,
      environment: {},
    });

    expect(factory).toHaveBeenCalledWith({
      baseUrl: "https://example.test",
      username: "supplier-user",
      password: "supplier-password",
    });
    expect(login).toHaveBeenCalledOnce();
    await expect(prisma.upstreamConnection.findUniqueOrThrow({ where: { id: "primary" } })).resolves.toMatchObject({
      status: "CONNECTED",
      upstreamChannelId: "claude-1",
      failureCode: null,
    });
  });

  it("uses complete environment credentials after a connected channel is established", async () => {
    await prisma.upstreamConnection.create({
      data: {
        id: "primary",
        status: "CONNECTED",
        upstreamChannelId: "saved-channel",
      },
    });

    await expect(
      loadUpstreamCredentials(encryptionKey, {
        UPSTREAM_ACCOUNT: "environment-user",
        UPSTREAM_PASSWORD: "environment-password",
      }),
    ).resolves.toEqual({
      username: "environment-user",
      password: "environment-password",
      channelId: "saved-channel",
    });
  });

  it("clears a stale channel before starting with environment credentials", async () => {
    await prisma.upstreamConnection.create({
      data: {
        id: "primary",
        status: "CONNECTED",
        upstreamChannelId: "old-account-channel",
      },
    });

    await prepareEnvironmentConnection({
      UPSTREAM_ACCOUNT: "new-account",
      UPSTREAM_PASSWORD: "new-password",
    });

    await expect(
      prisma.upstreamConnection.findUniqueOrThrow({ where: { id: "primary" } }),
    ).resolves.toMatchObject({
      status: "UNCONFIGURED",
      upstreamChannelId: null,
    });
  });

  it("rejects a partial environment credential pair without exposing its value", async () => {
    const secret = "only-one-secret-value";

    const result = loadUpstreamCredentials(encryptionKey, {
      UPSTREAM_ACCOUNT: secret,
    });

    await expect(result).rejects.toThrow(
      "UPSTREAM_ACCOUNT and UPSTREAM_PASSWORD must be configured together",
    );
    await expect(result).rejects.not.toThrow(secret);
  });

  it("falls back to encrypted database credentials when environment credentials are absent", async () => {
    const username = encryptSecret("database-user", encryptionKey);
    const password = encryptSecret("database-password", encryptionKey);
    await prisma.upstreamConnection.create({
      data: {
        id: "primary",
        encryptedUsername: username.ciphertext,
        usernameIv: username.iv,
        usernameTag: username.authTag,
        encryptedPassword: password.ciphertext,
        passwordIv: password.iv,
        passwordTag: password.authTag,
      },
    });

    await expect(loadUpstreamCredentials(encryptionKey, {})).resolves.toMatchObject({
      username: "database-user",
      password: "database-password",
    });
  });

  it("creates the primary connection and accepts an official source type channel", async () => {
    const factory = vi.fn().mockReturnValue({
      login: vi.fn(),
      getChannels: vi.fn().mockResolvedValue([
        {
          id: "claude-proxy",
          name: "Claude 官方兼容代理",
          sourceType: "proxy",
        },
        { id: "claude-official", name: "ModelBoxs-Claude-按量", sourceType: "official" },
      ]),
    });

    await processConnectUpstream({
      encryptionKey,
      baseUrl: "https://example.test",
      factory,
      environment: {
        UPSTREAM_ACCOUNT: "environment-user",
        UPSTREAM_PASSWORD: "environment-password",
      },
    });

    await expect(
      prisma.upstreamConnection.findUniqueOrThrow({ where: { id: "primary" } }),
    ).resolves.toMatchObject({
      status: "CONNECTED",
      upstreamChannelId: "claude-official",
    });
  });

  it("re-enqueues pending and channel-unavailable records after connecting", async () => {
    const pending = await createWorkerRecord("sk-ant-api03-pending-X7AA");
    const unavailable = await createWorkerRecord("sk-ant-api03-unavailable-X7AA");
    await prisma.keyRecord.update({
      where: { id: unavailable.id },
      data: { status: "UPSTREAM_ERROR", failureCode: "CHANNEL_UNAVAILABLE" },
    });
    const unrelated = await createWorkerRecord("sk-ant-api03-unrelated-X7AA");
    await prisma.keyRecord.update({
      where: { id: unrelated.id },
      data: { status: "UPSTREAM_ERROR", failureCode: "UPSTREAM_FAILURE" },
    });
    const enqueueRecoverable = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn().mockReturnValue({
      login: vi.fn(),
      getChannels: vi.fn().mockResolvedValue([
        { id: "claude-official", name: "Claude", sourceType: "official" },
      ]),
    });

    await processConnectUpstream({
      encryptionKey,
      baseUrl: "https://example.test",
      factory,
      environment: {
        UPSTREAM_ACCOUNT: "environment-user",
        UPSTREAM_PASSWORD: "environment-password",
      },
      enqueueRecoverable,
    });

    expect(enqueueRecoverable).toHaveBeenCalledOnce();
    expect(enqueueRecoverable.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([pending.id, unavailable.id]),
    );
    expect(enqueueRecoverable.mock.calls[0]?.[0]).not.toContain(unrelated.id);
  });
});
