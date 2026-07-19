import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  keyhubPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.keyhubPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.keyhubPrisma = prisma;
}
