import { describe, expect, it } from "vitest";

import {
  KeyInputError,
  analyzeBatch,
  fingerprintKey,
  maskKey,
  parseBatch,
} from "./keys.js";

describe("parseBatch", () => {
  it("parses comma and whitespace separated rows", () => {
    expect(parseBatch("sk-ant-a, 24\nsk-ant-b 48")).toEqual([
      { apiKey: "sk-ant-a", warrantyHours: 24 },
      { apiKey: "sk-ant-b", warrantyHours: 48 },
    ]);
  });

  it("defaults Key-only rows to a one-hour warranty", () => {
    expect(parseBatch("sk-ant-a\nsk-ant-b")).toEqual([
      { apiKey: "sk-ant-a", warrantyHours: 1 },
      { apiKey: "sk-ant-b", warrantyHours: 1 },
    ]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    expect(parseBatch("\n  sk-ant-a,24  \n\n")).toEqual([
      { apiKey: "sk-ant-a", warrantyHours: 24 },
    ]);
  });

  it("reports the source row for an invalid warranty", () => {
    expect(() => parseBatch("sk-ant-a, zero")).toThrowError(
      new KeyInputError([{ row: 1, message: "质保期必须是 1 到 8760 之间的整数" }]),
    );
  });

  it("keeps the first row when a batch contains duplicate Keys", () => {
    expect(parseBatch("sk-ant-a,24\nsk-ant-a,48\nsk-ant-b")).toEqual([
      { apiKey: "sk-ant-a", warrantyHours: 24 },
      { apiKey: "sk-ant-b", warrantyHours: 1 },
    ]);
  });
});

describe("analyzeBatch", () => {
  it("summarizes non-empty, unique, duplicate, and invalid rows", () => {
    expect(analyzeBatch("sk-ant-a\nsk-ant-a,2\nnot valid, nope\n\n")).toMatchObject({
      totalRows: 3,
      submitableRows: 1,
      duplicateRows: 1,
      invalidRows: 1,
    });
  });
});

describe("Key identifiers", () => {
  it("masks a Key using the familiar prefix and final four characters", () => {
    expect(maskKey("sk-ant-api03-abcdefX7AA")).toBe("sk-ant-****X7AA");
  });

  it("does not expose short secret values", () => {
    expect(maskKey("short")).toBe("****");
  });

  it("creates stable, key-dependent HMAC fingerprints", () => {
    const hmacKey = Buffer.alloc(32, 7);
    const first = fingerprintKey("sk-ant-a", hmacKey);

    expect(first).toHaveLength(64);
    expect(fingerprintKey("sk-ant-a", hmacKey)).toBe(first);
    expect(fingerprintKey("sk-ant-b", hmacKey)).not.toBe(first);
  });
});
