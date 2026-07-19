import type { SupplierPortalClientOptions, UpstreamChannel } from "@keyhub/upstream";

import { prisma } from "@keyhub/database";
import { decryptSecret } from "@keyhub/domain";

import {
  inspectEnvironmentCredentials,
  type UpstreamEnvironment,
} from "../startup.js";

interface ConnectClient {
  login(): Promise<void>;
  getChannels(): Promise<UpstreamChannel[]>;
}

export interface ConnectDependencies {
  encryptionKey: Buffer;
  baseUrl: string;
  factory(options: SupplierPortalClientOptions): ConnectClient;
  environment?: UpstreamEnvironment;
  enqueueRecoverable?(recordIds: string[]): Promise<void>;
}

export interface UpstreamCredentials {
  username: string;
  password: string;
  channelId?: string;
}

export async function prepareEnvironmentConnection(
  environment: UpstreamEnvironment,
): Promise<void> {
  if (!inspectEnvironmentCredentials(environment).configured) return;
  await prisma.upstreamConnection.updateMany({
    where: { id: "primary" },
    data: { status: "UNCONFIGURED", upstreamChannelId: null },
  });
}

export async function loadUpstreamCredentials(
  encryptionKey: Buffer,
  environment: UpstreamEnvironment = process.env,
): Promise<UpstreamCredentials> {
  const environmentCredentials = inspectEnvironmentCredentials(environment);
  const connection = await prisma.upstreamConnection.findUnique({
    where: { id: "primary" },
  });
  if (environmentCredentials.configured) {
    return {
      username: environmentCredentials.username,
      password: environmentCredentials.password,
      ...(connection?.status === "CONNECTED" && connection.upstreamChannelId
        ? { channelId: connection.upstreamChannelId }
        : {}),
    };
  }
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
  const { username, password } = await loadUpstreamCredentials(
    dependencies.encryptionKey,
    dependencies.environment,
  );
  const client = dependencies.factory({
    baseUrl: dependencies.baseUrl,
    username,
    password,
  });

  try {
    await prisma.upstreamConnection.upsert({
      where: { id: "primary" },
      create: { id: "primary", status: "CONNECTING" },
      update: { status: "CONNECTING" },
    });
    await client.login();
    const channels = await client.getChannels();
    const channel = channels.find(
      (candidate) =>
        candidate.name.includes("Claude") &&
        (candidate.sourceType === "official"
          || (candidate.sourceType === undefined && candidate.name.includes("官方"))),
    );
    if (!channel) throw new Error("Claude channel is unavailable");
    await prisma.upstreamConnection.upsert({
      where: { id: "primary" },
      create: {
        id: "primary",
        status: "CONNECTED",
        upstreamChannelId: channel.id,
        lastLoginAt: new Date(),
        lastSuccessAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
      update: {
        status: "CONNECTED",
        upstreamChannelId: channel.id,
        lastLoginAt: new Date(),
        lastSuccessAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
    });
  } catch {
    await prisma.upstreamConnection.upsert({
      where: { id: "primary" },
      create: {
        id: "primary",
        status: "BLOCKED",
        lastFailureAt: new Date(),
        failureCode: "UPSTREAM_LOGIN_FAILED",
        failureMessage: "上游登录或渠道识别失败",
      },
      update: {
        status: "BLOCKED",
        lastFailureAt: new Date(),
        failureCode: "UPSTREAM_LOGIN_FAILED",
        failureMessage: "上游登录或渠道识别失败",
      },
    });
    throw new Error("Upstream connection failed");
  }

  if (dependencies.enqueueRecoverable) {
    const recoverable = await prisma.keyRecord.findMany({
      where: {
        upstreamItemId: null,
        OR: [
          { status: "PENDING" },
          { status: "UPSTREAM_ERROR", failureCode: "CHANNEL_UNAVAILABLE" },
        ],
      },
      select: { id: true },
    });
    await dependencies.enqueueRecoverable(recoverable.map(({ id }) => id));
  }
}
