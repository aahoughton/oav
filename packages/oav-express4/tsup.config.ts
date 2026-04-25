import { resolve } from "node:path";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

/**
 * Build config for `oav-express4` — the Express 4 adapter.
 *
 * Thin tarball: nothing from `oav-core` is bundled. The adapter
 * imports `@oav/core` / `@oav/validator` (workspace aliases) in
 * source; the plugin below rewrites those to `@aahoughton/oav-core/*`
 * AND marks them external so the published bundle resolves them
 * from the consumer's install of `@aahoughton/oav-core` (or
 * `@aahoughton/oav`, which transitively provides it).
 *
 * `express` is a peer dep — never bundled. `@types/express` is a
 * dev dep and only contributes to the .d.ts emit.
 */
const oavCoreRewrite: Record<string, string> = {
  "@oav/core": "@aahoughton/oav-core/core",
  "@oav/validator": "@aahoughton/oav-core",
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
  external: ["express", "@aahoughton/oav-core"],
  esbuildPlugins: [rewriteOavCore()],
});
