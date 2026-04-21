import { defineConfig } from "tsup";
import { workspaceAliases } from "./workspace-aliases.js";

/**
 * Single-package build for the publishable `oav`.
 *
 * Each entry becomes a subpath in the published package:
 *   src/index.ts            →  "oav"
 *   src/schema.ts           →  "oav/schema"
 *   src/schema-internals.ts →  "oav/schema/internals"
 *   src/spec.ts             →  "oav/spec"
 *   src/formats.ts          →  "oav/formats"
 *   src/core.ts             →  "oav/core"
 *   src/cli.ts              →  "oav" binary
 *
 * The internal `@oav/*` workspace packages are redirected to their
 * source via the esbuild `alias` option, then bundled in as normal
 * modules so consumers never see them. Only true runtime dependencies
 * (commander, yaml) stay external.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    schema: "src/schema.ts",
    "schema-internals": "src/schema-internals.ts",
    spec: "src/spec.ts",
    formats: "src/formats.ts",
    core: "src/core.ts",
    cli: "src/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  external: ["commander", "yaml"],
  esbuildOptions(options) {
    options.alias = workspaceAliases(__dirname);
  },
});
