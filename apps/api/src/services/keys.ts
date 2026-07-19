import { Prisma, prisma } from "@keyhub/database";
import {
  decryptSecret,
  encryptSecret,
  fingerprintKey,
  maskKey,
  type ParsedKeyRow,
} from "@keyhub/domain";

export class DuplicateKeyError extends Error {
  constructor() {
    super("该 Key 已存在，无法重复提交");
    this.name = "DuplicateKeyError";
  }
}

export interface KeySecrets {
  encryptionKey: Buffer;
  hmacKey: Buffer;
}

export function loadKeySecrets(): KeySecrets {
  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY_BASE64 ?? "", "base64");
  const hmacKey = Buffer.from(process.env.HMAC_KEY_BASE64 ?? "", "base64");
  if (encryptionKey.length !== 32 || hmacKey.length !== 32) {
    throw new Error("ENCRYPTION_KEY_BASE64 and HMAC_KEY_BASE64 must decode to 32 bytes");
  }
  return { encryptionKey, hmacKey };
}

export async function createKeyRecords(
  ownerId: string,
  rows: ParsedKeyRow[],
  secrets: KeySecrets,
) {
  const prepared = rows.map((row) => ({
    row,
    fingerprint: fingerprintKey(row.apiKey, secrets.hmacKey),
    encrypted: encryptSecret(row.apiKey, secrets.encryptionKey),
    maskedKey: maskKey(row.apiKey),
  }));
  const duplicate = await prisma.keyRecord.findFirst({
    where: { keyFingerprint: { in: prepared.map((item) => item.fingerprint) } },
    select: { id: true },
  });
  if (duplicate) throw new DuplicateKeyError();

  try {
    return await prisma.$transaction(
      prepared.map((item) =>
        prisma.keyRecord.create({
          data: {
            ownerId,
            encryptedKey: item.encrypted.ciphertext,
            encryptionIv: item.encrypted.iv,
            encryptionTag: item.encrypted.authTag,
            keyFingerprint: item.fingerprint,
            maskedKey: item.maskedKey,
            keySuffix: item.row.apiKey.slice(-4),
            warrantyHours: item.row.warrantyHours,
          },
          select: {
            id: true,
            maskedKey: true,
            warrantyHours: true,
            status: true,
            createdAt: true,
          },
        }),
      ),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateKeyError();
    }
    throw error;
  }
}

export async function revealOwnedKey(
  ownerId: string,
  recordId: string,
  encryptionKey: Buffer,
): Promise<string | null> {
  const record = await prisma.keyRecord.findFirst({
    where: { id: recordId, ownerId },
    select: { encryptedKey: true, encryptionIv: true, encryptionTag: true },
  });
  if (!record) return null;
  return decryptSecret(
    {
      ciphertext: record.encryptedKey,
      iv: record.encryptionIv,
      authTag: record.encryptionTag,
    },
    encryptionKey,
  );
}
