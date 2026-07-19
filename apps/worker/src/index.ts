import { Worker } from "bullmq";

import {
  createKeyHubQueues,
  redisConnectionFromUrl,
  SUBMISSION_QUEUE,
  SYNC_QUEUE,
  type SubmitKeyJob,
  type SyncKeysJob,
} from "@keyhub/queue";
import { SupplierPortalClient } from "@keyhub/upstream";

import {
  loadUpstreamCredentials,
  processConnectUpstream,
} from "./processors/connect-upstream.js";
import { processSubmitKey } from "./processors/submit-key.js";
import { processSyncKeys } from "./processors/sync-keys.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const baseUrl = process.env.UPSTREAM_BASE_URL ?? "https://lingshu.101aix.net";
const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY_BASE64 ?? "", "base64");
if (encryptionKey.length !== 32) {
  throw new Error("ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
}
const connection = redisConnectionFromUrl(redisUrl);
const queues = createKeyHubQueues(redisUrl);

async function runtimeClient() {
  const credentials = await loadUpstreamCredentials(encryptionKey);
  return {
    client: new SupplierPortalClient({
      baseUrl,
      username: credentials.username,
      password: credentials.password,
    }),
    channelId: credentials.channelId,
  };
}

const submissionWorker = new Worker<SubmitKeyJob>(
  SUBMISSION_QUEUE,
  async (job) => {
    const runtime = await runtimeClient();
    return processSubmitKey(job.data, {
      client: runtime.client,
      encryptionKey,
      channelId: runtime.channelId,
    });
  },
  { connection, concurrency: 3 },
);

const syncWorker = new Worker<SyncKeysJob>(
  SYNC_QUEUE,
  async (job) => {
    if (job.name === "connect-upstream") {
      return processConnectUpstream({
        encryptionKey,
        baseUrl,
        factory: (options) => new SupplierPortalClient(options),
      });
    }
    const runtime = await runtimeClient();
    if (!runtime.channelId) throw new Error("Upstream channel is not configured");
    return processSyncKeys(job.data, {
      client: runtime.client,
      channelId: runtime.channelId,
    });
  },
  { connection, concurrency: 1 },
);

await queues.syncQueue.upsertJobScheduler(
  "sync-every-five-minutes",
  { every: 5 * 60 * 1000 },
  { name: "sync-all", data: {} },
);

async function shutdown(): Promise<void> {
  await Promise.all([
    submissionWorker.close(),
    syncWorker.close(),
    queues.submissionQueue.close(),
    queues.syncQueue.close(),
  ]);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
