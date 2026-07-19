import { pathToFileURL } from "node:url";

import { hash } from "argon2";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "./client.js";

export interface AdminSeedInput {
  username: string;
  password: string;
}

export async function seedAdmin(
  client: PrismaClient,
  input: AdminSeedInput,
): Promise<void> {
  if (input.password.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  }
  const passwordHash = await hash(input.password, { type: 2 });

  await client.user.upsert({
    where: { username: input.username },
    create: {
      username: input.username,
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
    update: {
      passwordHash,
      role: "ADMIN",
      isActive: true,
      sessionVersion: { increment: 1 },
    },
  });
}

async function main(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required");
  }
  await seedAdmin(prisma, { username, password });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .finally(async () => prisma.$disconnect())
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Seed failed");
      process.exitCode = 1;
    });
}
