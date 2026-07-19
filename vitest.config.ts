import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@keyhub/database": fileURLToPath(
        new URL("./packages/database/src/index.ts", import.meta.url),
      ),
      "@keyhub/domain": fileURLToPath(
        new URL("./packages/domain/src/index.ts", import.meta.url),
      ),
      "@keyhub/queue": fileURLToPath(
        new URL("./packages/queue/src/index.ts", import.meta.url),
      ),
      "@keyhub/upstream": fileURLToPath(
        new URL("./packages/upstream/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    fileParallelism: false,
    projects: ["packages/*", "apps/*"],
  },
});
