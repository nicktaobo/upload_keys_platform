import { Queue, type ConnectionOptions } from "bullmq";

export const SUBMISSION_QUEUE = "keyhub-submissions";
export const SYNC_QUEUE = "keyhub-sync";

export interface SubmitKeyJob {
  keyRecordId: string;
}

export interface SyncKeysJob {
  ownerId?: string;
  requestedBy?: string;
}

export function redisConnectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
  };
}

export function createKeyHubQueues(redisUrl: string) {
  const connection = redisConnectionFromUrl(redisUrl);
  return {
    submissionQueue: new Queue<SubmitKeyJob>(SUBMISSION_QUEUE, { connection }),
    syncQueue: new Queue<SyncKeysJob>(SYNC_QUEUE, { connection }),
  };
}
