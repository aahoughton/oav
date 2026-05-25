import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./workspace-aliases.js";

export default defineConfig({
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: false,
  },
});
