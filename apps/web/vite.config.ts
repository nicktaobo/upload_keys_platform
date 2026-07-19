import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/react") || id.includes("/node_modules/scheduler")) {
            return "react-runtime";
          }
          if (
            id.includes("/node_modules/antd/") ||
            id.includes("/node_modules/@ant-design/") ||
            id.includes("/node_modules/rc-") ||
            id.includes("/node_modules/@rc-component/")
          ) {
            return "ant-design-runtime";
          }
        },
      },
    },
  },
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
