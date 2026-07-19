import { Queue, type ConnectionOptions, type RedisOptions } from "bullmq";

export const SUBMISSION_QUEUE = "keyhub-submissions";
export const SYNC_QUEUE = "keyhub-sync";

export interface SubmitKeyJob {
  keyRecordId: string;
}

export interface SyncKeysJob {
  ownerId?: string;
  requestedBy?: string;
}

function parseRedisUrl(redisUrl: string): URL {
  try {
    return new URL(redisUrl);
  } catch {
    throw new TypeError("Invalid Redis URL");
  }
}

function decodeCredential(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TypeError("Invalid Redis URL credentials");
  }
}

function parseDatabase(pathname: string): number {
  if (pathname === "" || pathname === "/") return 0;
  const value = pathname.slice(1);
  if (!/^\d+$/.test(value)) {
    throw new TypeError("Redis URL database index must be a non-negative integer");
  }
  const db = Number(value);
  if (!Number.isSafeInteger(db)) {
    throw new TypeError("Redis URL database index must be a non-negative integer");
  }
  return db;
}

function parseOptionalInteger(
  url: URL,
  name: "connectTimeout" | "family",
): number | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !/^\d+$/.test(values[0] ?? "")) {
    throw new TypeError(`Redis URL ${name} must be a valid integer`);
  }

  const value = Number(values[0]);
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Redis URL ${name} must be a valid integer`);
  }
  return value;
}

export function redisConnectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = parseRedisUrl(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new TypeError("Redis URL protocol must be redis: or rediss:");
  }
  if (!url.hostname) throw new TypeError("Redis URL host is required");

  for (const name of url.searchParams.keys()) {
    if (name !== "connectTimeout" && name !== "family") {
      throw new TypeError("Unsupported Redis URL parameter");
    }
  }

  const port = Number(url.port || 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("Redis URL port must be between 1 and 65535");
  }

  const connectTimeout = parseOptionalInteger(url, "connectTimeout");
  if (connectTimeout !== undefined && connectTimeout < 1) {
    throw new TypeError("Redis URL connectTimeout must be a positive integer");
  }

  const family = parseOptionalInteger(url, "family");
  if (family !== undefined && family !== 0 && family !== 4 && family !== 6) {
    throw new TypeError("Redis URL family must be 0, 4, or 6");
  }

  const options: RedisOptions = {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    username: decodeCredential(url.username),
    password: decodeCredential(url.password),
    db: parseDatabase(url.pathname),
  };
  if (url.protocol === "rediss:") options.tls = {};
  if (connectTimeout !== undefined) options.connectTimeout = connectTimeout;
  if (family !== undefined) options.family = family;
  return options;
}

export function createKeyHubQueues(redisUrl: string) {
  const connection = redisConnectionFromUrl(redisUrl);
  return {
    submissionQueue: new Queue<SubmitKeyJob>(SUBMISSION_QUEUE, { connection }),
    syncQueue: new Queue<SyncKeysJob>(SYNC_QUEUE, { connection }),
  };
}
