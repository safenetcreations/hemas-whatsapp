import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/firestore.rules.test.ts",
      "tests/storage.rules.test.ts",
      "functions/**",
      "node_modules/**",
    ],
  },
});
