import { resolve } from "node:path";
import { defineConfig } from "tsup";

/**
 * Single-package build for the publishable `oav`.
 *
 * Each entry becomes a subpath in the published package:
 *   src/index.ts  →  "oav"
 *   src/schema.ts →  "oav/schema"
 *   src/spec.ts   →  "oav/spec"
 *   src/formats.ts → "oav/formats"
 *   src/core.ts   →  "oav/core"
 *   src/cli.ts    →  "oav" binary
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
    options.alias = {
      "@oav/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@oav/schema": resolve(__dirname, "packages/schema/src/index.ts"),
      "@oav/formats": resolve(__dirname, "packages/formats/src/index.ts"),
      "@oav/spec": resolve(__dirname, "packages/spec/src/index.ts"),
      "@oav/router": resolve(__dirname, "packages/router/src/index.ts"),
      "@oav/validator": resolve(__dirname, "packages/validator/src/index.ts"),
      "@oav/cli": resolve(__dirname, "packages/cli/src/index.ts"),
    };
  },
});
