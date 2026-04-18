import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./workspace-aliases.js";

export default defineConfig({
  resolve: {
    alias: workspaceAliases(__dirname),
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
