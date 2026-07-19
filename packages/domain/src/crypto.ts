export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes");
  }
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedSecret {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  assertKey(key);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
