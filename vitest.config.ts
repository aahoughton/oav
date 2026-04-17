import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
