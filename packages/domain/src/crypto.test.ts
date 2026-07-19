import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./crypto.js";

describe("secret encryption", () => {
  it("round-trips a secret using AES-256-GCM", () => {
    const key = Buffer.alloc(32, 3);
    const encrypted = encryptSecret("sk-ant-api03-secret", key);

    expect(encrypted.ciphertext).not.toContain("sk-ant");
    expect(decryptSecret(encrypted, key)).toBe("sk-ant-api03-secret");
  });

  it("uses a fresh IV for every encryption", () => {
    const key = Buffer.alloc(32, 3);

    expect(encryptSecret("same", key).iv).not.toBe(encryptSecret("same", key).iv);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptSecret("secret", Buffer.alloc(16))).toThrow(
      "Encryption key must be exactly 32 bytes",
    );
  });

  it("detects modified ciphertext", () => {
    const key = Buffer.alloc(32, 3);
    const encrypted = encryptSecret("secret", key);
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;

    expect(() =>
      decryptSecret({ ...encrypted, ciphertext: bytes.toString("base64") }, key),
    ).toThrow();
  });
});
