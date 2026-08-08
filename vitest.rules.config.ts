import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/firestore.rules.test.ts", "tests/storage.rules.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
