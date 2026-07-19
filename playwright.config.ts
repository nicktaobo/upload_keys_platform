import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    headless: true,
    trace: "retain-on-failure",
  },
});
