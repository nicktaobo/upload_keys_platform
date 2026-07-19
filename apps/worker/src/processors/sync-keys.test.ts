import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@keyhub/database";

import { processSyncKeys } from "./sync-keys.js";
import { createWorkerRecord, resetWorkerFixtures } from "../test/helpers.js";

describe("processSyncKeys", () => {
  beforeEach(resetWorkerFixtures);
  afterAll(async () => {
    await resetWorkerFixtures();
    await prisma.$disconnect();
  });

  it("updates mapped records and ignores unmapped upstream items", async () => {
    const record = await createWorkerRecord("sk-ant-api03-sync-X7AA", "item-101");
    const getItems = vi.fn().mockResolvedValue({
      items: [
        {
          id: "item-101",
          status: "通过",
          usageUsd: 21.51,
          usageSiteCount: 2,
          sampledAt: "2026-07-19T14:21:48.000Z",
        },
        { id: "not-owned", status: "通过", usageUsd: 999 },
      ],
      nextCursor: null,
    });

    const result = await processSyncKeys(
      {},
      { client: { login: vi.fn(), getItems }, channelId: "channel-1" },
    );

    expect(result.updated).toBe(1);
    const updated = await prisma.keyRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(Number(updated.usageUsd)).toBe(21.51);
    expect(updated.usageSiteCount).toBe(2);
    expect(updated.accessStatus).toBe("通过");
    expect(await prisma.keyRecord.count()).toBe(1);
  });

  it("logs in once before reading pages with a newly created client", async () => {
    let authenticated = false;
    const login = vi.fn().mockImplementation(async () => {
      authenticated = true;
    });
    const getItems = vi.fn().mockImplementation(async () => {
      if (!authenticated) throw new Error("anonymous request");
      return { items: [], nextCursor: null };
    });

    await processSyncKeys(
      {},
      { client: { login, getItems }, channelId: "channel-1" },
    );

    expect(login).toHaveBeenCalledOnce();
    expect(login.mock.invocationCallOrder[0]).toBeLessThan(
      getItems.mock.invocationCallOrder[0]!,
    );
  });

  it("limits an owner refresh to that owner's mapped records", async () => {
    const first = await createWorkerRecord("sk-ant-api03-first-X7AA", "item-first");
    await createWorkerRecord("sk-ant-api03-second-M2PA", "item-second");
    const getItems = vi.fn().mockResolvedValue({
      items: [
        { id: "item-first", status: "通过", usageUsd: 1 },
        { id: "item-second", status: "通过", usageUsd: 2 },
      ],
      nextCursor: null,
    });

    const result = await processSyncKeys(
      { ownerId: first.ownerId },
      { client: { login: vi.fn(), getItems }, channelId: "channel-1" },
    );

    expect(result.updated).toBe(1);
    expect(Number((await prisma.keyRecord.findUniqueOrThrow({ where: { id: first.id } })).usageUsd)).toBe(1);
    expect(
      Number((await prisma.keyRecord.findUniqueOrThrow({ where: { upstreamItemId: "item-second" } })).usageUsd),
    ).toBe(0);
  });
});
