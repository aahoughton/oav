import { resolve } from "node:path";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

/**
 * Build config for `oav-express5`, the Express 5 adapter.
 * Same shape as oav-express4: thin tarball, oav-core externalized,
 * express marked external (peer dep).
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
