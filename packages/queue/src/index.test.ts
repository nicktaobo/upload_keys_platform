import { describe, expect, it } from "vitest";

import { redisConnectionFromUrl } from "./index.js";

function captureTypeError(redisUrl: string): TypeError {
  let thrown: unknown;
  try {
    redisConnectionFromUrl(redisUrl);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(TypeError);
  return thrown as TypeError;
}

describe("redisConnectionFromUrl", () => {
  it("preserves secure Redis connection options", () => {
    expect(
      redisConnectionFromUrl(
        "rediss://user%40tenant:p%3Ass@[::1]:6380/2?connectTimeout=5000&family=6",
      ),
    ).toEqual({
      host: "::1",
      port: 6380,
      username: "user@tenant",
      password: "p:ss",
      db: 2,
      tls: {},
      connectTimeout: 5000,
      family: 6,
    });
  });

  it("keeps plain Redis connections non-TLS", () => {
    const options = redisConnectionFromUrl("redis://localhost:6379/0");

    expect(options).toEqual({
      host: "localhost",
      port: 6379,
      username: undefined,
      password: undefined,
      db: 0,
    });
    expect(options).not.toHaveProperty("tls");
  });

  it("rejects unsupported protocols without exposing credentials", () => {
    const redisUrl = "https://user:super-secret@example.com/0";
    const error = captureTypeError(redisUrl);

    expect(error.message).toContain("Redis URL protocol");
    expect(error.message).not.toContain(redisUrl);
    expect(error.message).not.toContain("super-secret");
  });

  it.each([
    ["redis://:super-secret@localhost/not-a-db", "database index"],
    ["redis://:super-secret@localhost:70000/0", "Invalid Redis URL"],
    ["redis://:super-secret@localhost/0?connectTimeout=slow", "connectTimeout"],
    ["redis://:super-secret@localhost/0?family=5", "family"],
    ["redis://:super-secret@localhost/0?password=override", "parameter"],
  ])("rejects invalid Redis URL options safely: %s", (redisUrl, expectedMessage) => {
    const error = captureTypeError(redisUrl);

    expect(error.message).toContain(expectedMessage);
    expect(error.message).not.toContain(redisUrl);
    expect(error.message).not.toContain("super-secret");
  });
});
