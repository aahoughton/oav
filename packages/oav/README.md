# oav

Batteries-included distribution of `@aahoughton/oav-core`. Adds YAML
readers and the `oav` CLI on top of the lean validator package; the
programmatic surface is identical.

```ts
import { createValidator, createYamlFileReader } from "@aahoughton/oav";
import { loadSpec } from "@aahoughton/oav/spec";

const { document } = await loadSpec({
  reader: createYamlFileReader(),
  entry: "openapi.yaml",
});
const validator = createValidator(document);
```

## When to use which

| Package                | When to use                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@aahoughton/oav`      | Default. YAML support out of the box; ships the `oav` CLI as a `bin`. Pulls in `yaml`, `commander`, and `esbuild` (CLI-only).                                                                           |
| `@aahoughton/oav-core` | Lean. Zero runtime dependencies. JSON specs only (or pre-parsed objects via the memory reader). Use on Cloudflare Workers, Vercel Edge, Lambda@Edge, or anywhere the YAML/CLI footprint isn't worth it. |

`oav` re-exports every subpath of `oav-core` at matching paths
(`oav/schema`, `oav/spec`, `oav/formats`, `oav/core`,
`oav/schema/internals`, `oav/validator/internals`). Code written
against one swaps to the other by changing the package name in
imports — no surface changes.

## What this package adds

- **`createYamlFileReader()`** — file reader for `.yaml` / `.yml`
  paths. Calling `oav-core`'s `createFileReader()` on a YAML path
  throws an install-hint pointing here.
- **`createSmartHttpReader()`** — HTTP reader that parses both JSON
  and YAML by inspecting `Content-Type` / file extension.
- **`parseYamlString(source)`** — exposed for callers loading YAML
  out-of-band (e.g. fetched from a config service).
- **The `oav` CLI binary** — `oav resolve`, `oav validate`,
  `oav compile-schema`, `oav compile-spec`. See
  [`packages/cli/README.md`](../cli/README.md) for commands and
  flags.

Everything else (`createValidator`, `compileSchema`, error helpers,
formatters, `summarize`, `toProblemDetails`, HTTP-status helpers, …)
is re-exported from `oav-core`. Documentation for those lives in:

- [`packages/core/README.md`](../core/README.md) — error tree,
  formatters, HTTP helpers.
- [`packages/validator/README.md`](../validator/README.md) — the
  HTTP validator.
- [`packages/schema/README.md`](../schema/README.md) — the JSON
  Schema compiler.
- [`packages/spec/README.md`](../spec/README.md) — multi-file
  loader, resolver, overlays.
- [`packages/formats/README.md`](../formats/README.md) — built-in
  string format validators.

## Framework integration

`oav` is a validator, not a middleware package — you write a short
adapter between your HTTP framework and `validateRequest` /
`validateResponse`. For Express 4 specifically, the
[`@aahoughton/oav-express4`](../oav-express4/README.md) companion
package ships the middleware as a one-liner with sensible defaults;
sibling packages for Express 5, Fastify, and Hono will follow the
same shape. See [`INTEGRATION.md`](../../INTEGRATION.md) for adapter
recipes for every supported framework, plus migration notes from
`express-openapi-validator`.

## See also

- [Top-level `README.md`](../../README.md) — full rationale, install
  matrix, comparison.
- [`INTEGRATION.md`](../../INTEGRATION.md) — adapter recipes,
  security wiring, response validation, file uploads, migration.
- [`OVERLAYS.md`](../../OVERLAYS.md) — extending an externally-owned
  base spec at load time.
- [`COMPARISON.md`](../../COMPARISON.md) — feature comparison vs Ajv.
