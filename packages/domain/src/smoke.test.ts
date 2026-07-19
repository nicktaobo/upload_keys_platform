import { describe, expect, it } from "vitest";

import { APP_NAME } from "./index.js";

describe("domain package", () => {
  it("exports the product name", () => {
    expect(APP_NAME).toBe("KeyHub");
  });
});
