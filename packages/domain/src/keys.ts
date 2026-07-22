export { KeyInputError, analyzeBatch, parseBatch } from "./batch.js";
export type { BatchAnalysis, KeyInputIssue, ParsedKeyRow } from "./batch.js";

export function maskKey(apiKey: string): string {
  if (apiKey.length < 9) return "****";
  const suffix = apiKey.slice(-4);
  return apiKey.startsWith("sk-ant-")
    ? `sk-ant-****${suffix}`
    : `${apiKey.slice(0, 4)}****${suffix}`;
}

export function fingerprintKey(apiKey: string, hmacKey: Buffer): string {
  return createHmac("sha256", hmacKey).update(apiKey, "utf8").digest("hex");
}
import { createHmac } from "node:crypto";
