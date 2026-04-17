import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@oav/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@oav/schema": resolve(__dirname, "packages/schema/src/index.ts"),
      "@oav/formats": resolve(__dirname, "packages/formats/src/index.ts"),
      "@oav/spec": resolve(__dirname, "packages/spec/src/index.ts"),
      "@oav/router": resolve(__dirname, "packages/router/src/index.ts"),
      "@oav/validator": resolve(__dirname, "packages/validator/src/index.ts"),
    },
  },
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
