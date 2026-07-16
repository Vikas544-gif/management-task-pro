import { defineConfig } from "vitest/config";
import path from "path";

// Dedicated Vitest config so the test runner does NOT fall back to vite.config.ts
// (which throws unless PORT / BASE_PATH are set by the workflow). The compliance
// date helpers under test are pure TS, so a plain node environment is enough.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
