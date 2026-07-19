import { randomUUID } from "node:crypto";

import type { SubmitKeyJob } from "@keyhub/queue";

export type UpstreamEnvironment = Record<string, string | undefined>;

export type EnvironmentCredentialState =
  | { configured: false }
  | { configured: true; username: string; password: string };

interface QueueLike<T> {
  add(name: string, data: T, options: Record<string, unknown>): Promise<unknown>;
}

export function inspectEnvironmentCredentials(
  environment: UpstreamEnvironment,
): EnvironmentCredentialState {
  const username = environment.UPSTREAM_ACCOUNT;
  const password = environment.UPSTREAM_PASSWORD;
  const hasUsername = Boolean(username);
  const hasPassword = Boolean(password);

  if (hasUsername !== hasPassword) {
    throw new Error(
      "UPSTREAM_ACCOUNT and UPSTREAM_PASSWORD must be configured together",
    );
  }
  if (!hasUsername || !hasPassword) return { configured: false };
  return { configured: true, username: username!, password: password! };
}

function uniqueJobId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID()}`;
}

export async function scheduleStartupConnection(
  queue: QueueLike<Record<string, never>>,
  environment: UpstreamEnvironment,
  createJobId: () => string = () => uniqueJobId("connect-startup"),
): Promise<void> {
  inspectEnvironmentCredentials(environment);
  await queue.add("connect-upstream", {}, {
    jobId: createJobId(),
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 50,
  });
}

export function createRecoveryEnqueuer(
  queue: QueueLike<SubmitKeyJob>,
  createJobId: (recordId: string) => string = (recordId) =>
    uniqueJobId(`recover-${recordId}`),
): (recordIds: string[]) => Promise<void> {
  return async (recordIds) => {
    const results = await Promise.allSettled(
      recordIds.map((keyRecordId) =>
        queue.add(
          "submit-key",
          { keyRecordId },
          {
            jobId: createJobId(keyRecordId),
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: 50,
          },
        ),
      ),
    );
    if (results.some(({ status }) => status === "rejected")) {
      throw new Error("Recovery queue unavailable");
    }
  };
}
