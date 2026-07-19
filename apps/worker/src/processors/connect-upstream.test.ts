import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@keyhub/database";
import { encryptSecret } from "@keyhub/domain";

import { processConnectUpstream } from "./connect-upstream.js";
import { encryptionKey, resetWorkerFixtures } from "../test/helpers.js";

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

    await processConnectUpstream({ encryptionKey, baseUrl: "https://example.test", factory });

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
});
