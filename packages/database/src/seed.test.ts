import { verify } from "argon2";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "./client.js";
import { seedAdmin } from "./seed.js";

describe("seedAdmin", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: "seed-admin" } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seed-admin" } });
    await prisma.$disconnect();
  });

  it("creates one active administrator with an Argon2id password hash", async () => {
    await seedAdmin(prisma, {
      username: "seed-admin",
      password: "first-password",
    });

    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: "seed-admin" },
    });
    expect(admin.role).toBe("ADMIN");
    expect(admin.isActive).toBe(true);
    expect(admin.passwordHash).not.toContain("first-password");
    expect(await verify(admin.passwordHash, "first-password")).toBe(true);
  });

  it("updates the existing administrator instead of creating a duplicate", async () => {
    await seedAdmin(prisma, {
      username: "seed-admin",
      password: "first-password",
    });
    await seedAdmin(prisma, {
      username: "seed-admin",
      password: "second-password",
    });

    expect(await prisma.user.count({ where: { username: "seed-admin" } })).toBe(1);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: "seed-admin" },
    });
    expect(await verify(admin.passwordHash, "second-password")).toBe(true);
  });

  it("rejects bootstrap passwords shorter than twelve characters", async () => {
    await expect(
      seedAdmin(prisma, { username: "seed-admin", password: "too-short" }),
    ).rejects.toThrow("ADMIN_PASSWORD must be at least 12 characters");
  });
});
