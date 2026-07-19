import { prisma } from "@keyhub/database";
import { encryptSecret, fingerprintKey, maskKey } from "@keyhub/domain";

export const encryptionKey = Buffer.alloc(32, 3);
export const hmacKey = Buffer.alloc(32, 7);

export async function resetWorkerFixtures(): Promise<void> {
  await prisma.jobRun.deleteMany();
  await prisma.keyRecord.deleteMany();
  await prisma.user.deleteMany();
  await prisma.upstreamConnection.deleteMany();
}

export async function createWorkerRecord(apiKey: string, upstreamItemId?: string) {
  const owner = await prisma.user.create({
    data: {
      username: `worker-${Math.random().toString(36).slice(2)}`,
      passwordHash: "unused-in-worker-tests",
    },
  });
  const encrypted = encryptSecret(apiKey, encryptionKey);
  return prisma.keyRecord.create({
    data: {
      ownerId: owner.id,
      encryptedKey: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionTag: encrypted.authTag,
      keyFingerprint: fingerprintKey(apiKey, hmacKey),
      maskedKey: maskKey(apiKey),
      keySuffix: apiKey.slice(-4),
      warrantyHours: 24,
      upstreamChannelId: "channel-1",
      upstreamItemId,
      status: upstreamItemId ? "SUBMITTED" : "PENDING",
    },
  });
}
