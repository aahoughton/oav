import { resolve } from "node:path";

// Single source of truth for the @oav/* -> packages/*/src/index.ts alias
// map. Imported by tsup.config.ts and vitest.config.ts. tsconfig.build.json
// has its own copy under "paths" because JSON cannot import TS — keep it
// in sync when adding a new workspace package.

const PACKAGES = [
  "core",
  "schema",
  "formats",
  "spec",
  "overlay-spec",
  "router",
  "validator",
  "stream-validator",
  "cli",
  "oav",
  "oav-express4",
  "oav-express5",
  "oav-fastify",
] as const;

export function workspaceAliases(rootDir: string): Record<string, string> {
  // Sub-path barrel keys (more specific) come first so bundlers that
  // match on longest prefix / insertion order pick `@oav/<pkg>/internals`
  // before the base `@oav/<pkg>` alias.
  const subpathEntries: Array<[string, string]> = [
    ["@oav/schema/internals", resolve(rootDir, "packages", "schema", "src", "internals.ts")],
    ["@oav/spec/internals", resolve(rootDir, "packages", "spec", "src", "internals.ts")],
    ["@oav/validator/internals", resolve(rootDir, "packages", "validator", "src", "internals.ts")],
  ];
  const packageEntries = PACKAGES.map(
    (pkg) =>
      [`@oav/${pkg}`, resolve(rootDir, "packages", pkg, "src", "index.ts")] as [string, string],
  );
  // The stream validator is published standalone as `@aahoughton/oav-stream-validator`
  // (not folded into the oav-core bundle), so consumers inside the workspace
  // (the CLI) import it by that published name. Alias it to source too, so
  // tests / bundling resolve it without a prior build of its dist.
  const publishedEntries: Array<[string, string]> = [
    [
      "@aahoughton/oav-stream-validator",
      resolve(rootDir, "packages", "stream-validator", "src", "index.ts"),
    ],
  ];
  return Object.fromEntries([...subpathEntries, ...packageEntries, ...publishedEntries]);
}
