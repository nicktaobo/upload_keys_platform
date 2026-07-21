export interface ParsedKeyRow {
  apiKey: string;
  warrantyHours: number;
}

export interface KeyInputIssue {
  row: number;
  message: string;
}

export class KeyInputError extends Error {
  constructor(public readonly issues: KeyInputIssue[]) {
    super("Invalid Key input");
    this.name = "KeyInputError";
  }
}

export function parseBatch(input: string): ParsedKeyRow[] {
  const rows: ParsedKeyRow[] = [];
  const issues: KeyInputIssue[] = [];
  const seen = new Set<string>();

  for (const [index, source] of input.split(/\r?\n/u).entries()) {
    const line = source.trim();
    if (!line) continue;

    const match = /^(\S+?)\s*(?:,\s*|\s+)(\S+)$/u.exec(line);
    const apiKey = match?.[1] ?? (/^[^,\s]+$/u.test(line) ? line : undefined);
    const warranty = match ? Number(match[2]) : 1;

    if (!apiKey) {
      issues.push({ row: index + 1, message: "每行必须包含一个 Key，可选填写质保期" });
      continue;
    }
    if (!Number.isInteger(warranty) || warranty < 1 || warranty > 8760) {
      issues.push({ row: index + 1, message: "质保期必须是 1 到 8760 之间的整数" });
      continue;
    }
    if (seen.has(apiKey)) {
      issues.push({ row: index + 1, message: "批次中存在重复 Key" });
      continue;
    }

    seen.add(apiKey);
    rows.push({ apiKey, warrantyHours: warranty });
  }

  if (issues.length > 0) throw new KeyInputError(issues);
  return rows;
}

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
