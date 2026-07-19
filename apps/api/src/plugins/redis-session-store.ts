import type { Session } from "fastify";
import type { Redis } from "ioredis";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class RedisSessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "keyhub:session:",
  ) {}

  set(sessionId: string, session: Session, callback: (error?: Error) => void): void {
    const ttl = session.cookie.maxAge ?? DEFAULT_TTL_MS;
    this.redis
      .set(`${this.prefix}${sessionId}`, JSON.stringify(session), "PX", ttl)
      .then(() => callback())
      .catch((error: unknown) => callback(asError(error)));
  }

  get(
    sessionId: string,
    callback: (error: Error | null, session?: Session | null) => void,
  ): void {
    this.redis
      .get(`${this.prefix}${sessionId}`)
      .then((value) => callback(null, value ? (JSON.parse(value) as Session) : null))
      .catch((error: unknown) => callback(asError(error)));
  }

  destroy(sessionId: string, callback: (error?: Error) => void): void {
    this.redis
      .del(`${this.prefix}${sessionId}`)
      .then(() => callback())
      .catch((error: unknown) => callback(asError(error)));
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Redis session store failed");
}
