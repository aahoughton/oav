import { resolve } from "node:path";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

/**
 * Build config for `oav-stream-validator`, the streaming JSON Schema
 * validator.
 *
 * Thin tarball: nothing from `oav-core` is bundled. The engine imports
 * `@oav/core` / `@oav/schema` (workspace aliases) in source; the plugin
 * below rewrites those to `@aahoughton/oav-core/*` AND marks them
 * external, so the published bundle resolves them from the consumer's
 * install of `@aahoughton/oav-core` (a regular dependency). This is the
 * same pattern the framework adapters use; it keeps the in-memory
 * compiler from being duplicated into this tarball.
 *
 * The map covers every `@oav/*` subpath the source imports: the base
 * `@oav/schema` and `@oav/schema/internals` are distinct npm subpaths and
 * map separately. Keep this in sync with the imports if a new one is
 * added (an unmapped `@oav/*` import would be bundled from source instead
 * of externalized, silently fattening the tarball).
 */
const oavCoreRewrite: Record<string, string> = {
  "@oav/core": "@aahoughton/oav-core/core",
  "@oav/schema": "@aahoughton/oav-core/schema",
  "@oav/schema/internals": "@aahoughton/oav-core/schema/internals",
};

function rewriteOavCore(): Plugin {
  return {
    name: "oav-core-rewrite",
    setup(build) {
      build.onResolve({ filter: /^@oav\// }, (args) => {
        const rewrite = oavCoreRewrite[args.path];
        if (rewrite) return { path: rewrite, external: true };
        return null;
      });
    },
  };
}

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  tsconfig: resolve(__dirname, "../../tsconfig.build.json"),
  external: ["@aahoughton/oav-core"],
  esbuildPlugins: [rewriteOavCore()],
});
