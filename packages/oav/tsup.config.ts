import { resolve } from "node:path";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

/**
 * Build config for `@aahoughton/oav` — the batteries-included tarball.
 * Emits subpath shims that re-export `@aahoughton/oav-core/*`, adds
 * the YAML readers at the root entry, and bundles the `oav` CLI.
 *
 * Dependency shape:
 * - `@aahoughton/oav-core` and `yaml` are external runtime deps the
 *   consumer's install already provides.
 * - `commander` is an external optional-peer — resolved at CLI run
 *   time with a clear error when missing.
 * - `@oav/cli` (the workspace package that owns the CLI logic) is
 *   bundled in, along with everything it transitively imports from
 *   `@oav/*`. Those transitive imports are rewritten to the
 *   corresponding `@aahoughton/oav-core/*` subpaths AND marked
 *   external by the plugin below, so the final bundles still import
 *   the compiler / validator from oav-core at run time rather than
 *   inlining a second copy.
 *
 * Two configs are exported: the library entries emit both ESM and
 * CJS, while the CLI emits ESM only (top-level `await` in cli.ts
 * isn't legal in a CJS output, and the `bin` field points at
 * `./dist/cli.js` — Node picks up the ESM build regardless of
 * consumers' package type).
 */
const repoRoot = resolve(__dirname, "..", "..");

// `@oav/*` → `@aahoughton/oav-core[/*]`: kept external (resolved at
// run time from the consumer's install of oav-core).
const oavCoreRewrite: Record<string, string> = {
  "@oav/core": "@aahoughton/oav-core/core",
  "@oav/schema": "@aahoughton/oav-core/schema",
  "@oav/schema/internals": "@aahoughton/oav-core/schema/internals",
  "@oav/spec": "@aahoughton/oav-core/spec",
  "@oav/formats": "@aahoughton/oav-core/formats",
  "@oav/validator": "@aahoughton/oav-core",
  "@oav/validator/internals": "@aahoughton/oav-core/validator/internals",
};

// `@oav/cli` + `@oav/router`: private workspace packages bundled
// into this tarball (no external runtime counterpart).
const bundledWorkspace: Record<string, string> = {
  "@oav/cli": resolve(repoRoot, "packages", "cli", "src", "index.ts"),
  "@oav/router": resolve(repoRoot, "packages", "router", "src", "index.ts"),
};

// esbuild resolves aliases before external-matching, but only for
// the originally-imported specifier. Doing the rewrite+external in a
// single onResolve hook is the reliable way to get imports like
// `@oav/schema` emitted into the bundle as
// `import ... from "@aahoughton/oav-core/schema"`.
function rewriteOavCore(): Plugin {
  return {
    name: "oav-core-rewrite",
    setup(build) {
      build.onResolve({ filter: /^@oav\// }, (args) => {
        const rewrite = oavCoreRewrite[args.path];
        if (rewrite) return { path: rewrite, external: true };
        const bundled = bundledWorkspace[args.path];
        if (bundled) return { path: bundled };
        return null;
      });
    },
  };
}

const external = ["yaml", "commander"];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      schema: "src/schema.ts",
      "schema-internals": "src/schema-internals.ts",
      spec: "src/spec.ts",
      formats: "src/formats.ts",
      core: "src/core.ts",
      "validator-internals": "src/validator-internals.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
    tsconfig: "../../tsconfig.build.json",
    external,
    esbuildPlugins: [rewriteOavCore()],
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "es2022",
    tsconfig: "../../tsconfig.build.json",
    external,
    esbuildPlugins: [rewriteOavCore()],
  },
]);
