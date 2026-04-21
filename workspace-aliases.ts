import { resolve } from "node:path";

// Single source of truth for the @oav/* -> packages/*/src/index.ts alias
// map. Imported by tsup.config.ts and vitest.config.ts. tsconfig.build.json
// has its own copy under "paths" because JSON cannot import TS — keep it
// in sync when adding a new workspace package.

const PACKAGES = ["core", "schema", "formats", "spec", "router", "validator", "cli"] as const;

export function workspaceAliases(rootDir: string): Record<string, string> {
  // Sub-path barrel keys (more specific) come first so bundlers that
  // match on longest prefix / insertion order pick `@oav/<pkg>/internals`
  // before the base `@oav/<pkg>` alias.
  const subpathEntries: Array<[string, string]> = [
    ["@oav/schema/internals", resolve(rootDir, "packages", "schema", "src", "internals.ts")],
    ["@oav/validator/internals", resolve(rootDir, "packages", "validator", "src", "internals.ts")],
  ];
  const packageEntries = PACKAGES.map(
    (pkg) =>
      [`@oav/${pkg}`, resolve(rootDir, "packages", pkg, "src", "index.ts")] as [string, string],
  );
  return Object.fromEntries([...subpathEntries, ...packageEntries]);
}
