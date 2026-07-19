import { describe, expect, it, vi } from "vitest";

import {
  createRecoveryEnqueuer,
  inspectEnvironmentCredentials,
  scheduleStartupConnection,
} from "./startup.js";

describe("worker startup", () => {
  it("rejects a partial upstream environment credential pair", () => {
    expect(() =>
      inspectEnvironmentCredentials({ UPSTREAM_PASSWORD: "secret-password" }),
    ).toThrow("UPSTREAM_ACCOUNT and UPSTREAM_PASSWORD must be configured together");
  });

  it("schedules a connection task when environment credentials are configured", async () => {
    const add = vi.fn().mockResolvedValue(undefined);

    await scheduleStartupConnection(
      { add },
      {
        UPSTREAM_ACCOUNT: "supplier-user",
        UPSTREAM_PASSWORD: "supplier-password",
      },
      () => "connect-startup-unique",
    );

    expect(add).toHaveBeenCalledWith(
      "connect-upstream",
      {},
      expect.objectContaining({
        jobId: "connect-startup-unique",
        attempts: 3,
      }),
    );
  });

  it("schedules a connection task when database credentials are in use", async () => {
    const add = vi.fn().mockResolvedValue(undefined);

    await scheduleStartupConnection({ add }, {}, () => "connect-database");

    expect(add).toHaveBeenCalledWith(
      "connect-upstream",
      {},
      expect.objectContaining({ jobId: "connect-database", attempts: 3 }),
    );
  });

  it("uses a new job ID when recovering each submission", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const ids = ["job-one", "job-two"];
    const nextId = vi.fn().mockImplementation((recordId: string) =>
      `recover-${recordId}-${ids.shift()}`,
    );

    await createRecoveryEnqueuer({ add }, nextId)(["record-a", "record-a"]);

    expect(add).toHaveBeenNthCalledWith(
      1,
      "submit-key",
      { keyRecordId: "record-a" },
      expect.objectContaining({ jobId: "recover-record-a-job-one", attempts: 3 }),
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      "submit-key",
      { keyRecordId: "record-a" },
      expect.objectContaining({ jobId: "recover-record-a-job-two", attempts: 3 }),
    );
  });

  it("attempts every recovery enqueue and fails the batch when one add fails", async () => {
    const add = vi.fn()
      .mockRejectedValueOnce(new Error("redis unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      createRecoveryEnqueuer({ add })(["record-a", "record-b"]),
    ).rejects.toThrow("Recovery queue unavailable");

    expect(add).toHaveBeenCalledTimes(2);
  });
});
