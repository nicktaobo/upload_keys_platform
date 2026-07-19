import type { SupplierPortalClientOptions, UpstreamChannel } from "@keyhub/upstream";

import { prisma } from "@keyhub/database";
import { decryptSecret } from "@keyhub/domain";

interface ConnectClient {
  login(): Promise<void>;
  getChannels(): Promise<UpstreamChannel[]>;
}

export interface ConnectDependencies {
  encryptionKey: Buffer;
  baseUrl: string;
  factory(options: SupplierPortalClientOptions): ConnectClient;
}

export interface UpstreamCredentials {
  username: string;
  password: string;
  channelId?: string;
}

export async function loadUpstreamCredentials(
  encryptionKey: Buffer,
): Promise<UpstreamCredentials> {
  const connection = await prisma.upstreamConnection.findUnique({
    where: { id: "primary" },
  });
  if (
    !connection?.encryptedUsername ||
    !connection.usernameIv ||
    !connection.usernameTag ||
    !connection.encryptedPassword ||
    !connection.passwordIv ||
    !connection.passwordTag
  ) {
    throw new Error("Upstream credentials are not configured");
  }
  return {
    username: decryptSecret(
      {
        ciphertext: connection.encryptedUsername,
        iv: connection.usernameIv,
        authTag: connection.usernameTag,
      },
      encryptionKey,
    ),
    password: decryptSecret(
      {
        ciphertext: connection.encryptedPassword,
        iv: connection.passwordIv,
        authTag: connection.passwordTag,
      },
      encryptionKey,
    ),
    ...(connection.upstreamChannelId
      ? { channelId: connection.upstreamChannelId }
      : {}),
  };
}

export async function processConnectUpstream(
  dependencies: ConnectDependencies,
): Promise<void> {
  const { username, password } = await loadUpstreamCredentials(dependencies.encryptionKey);
  const client = dependencies.factory({
    baseUrl: dependencies.baseUrl,
    username,
    password,
  });

  try {
    await prisma.upstreamConnection.update({
      where: { id: "primary" },
      data: { status: "CONNECTING" },
    });
    await client.login();
    const channels = await client.getChannels();
    const channel = channels.find(
      (candidate) => candidate.name.includes("Claude") && candidate.name.includes("官方"),
    );
    if (!channel) throw new Error("Claude channel is unavailable");
    await prisma.upstreamConnection.update({
      where: { id: "primary" },
      data: {
        status: "CONNECTED",
        upstreamChannelId: channel.id,
        lastLoginAt: new Date(),
        lastSuccessAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
    });
  } catch {
    await prisma.upstreamConnection.update({
      where: { id: "primary" },
      data: {
        status: "BLOCKED",
        lastFailureAt: new Date(),
        failureCode: "UPSTREAM_LOGIN_FAILED",
        failureMessage: "上游登录或渠道识别失败",
      },
    });
    throw new Error("Upstream connection failed");
  }
}
