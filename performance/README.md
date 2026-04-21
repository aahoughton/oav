# @oav-dev/performance

Cross-library benchmarks for `@oav/schema` vs
[ajv](https://github.com/ajv-validator/ajv) (2020-12 dialect) vs
[@hyperjump/json-schema](https://github.com/hyperjump-io/json-schema).
Two benchmark entry points, two use cases.

## Bootstrap

Deps live in this sub-package and aren't part of the main workspace install:

```bash
cd performance
pnpm install
```

## Entry points

### `run.ts` — cross-library schema benchmark

```bash
pnpm bench                                      # default 500ms per task
pnpm bench:long                                 # 1500ms per task
pnpm bench -- --filter=petstore                 # one schema only
pnpm bench -- --time=250                        # quick smoke
pnpm bench -- --spec=path/to/openapi.yaml       # real spec mode
```

Two modes, one script:

- **Default (synthetic).** Iterates the schemas in `./schemas.ts` — a
  curated shape distribution (trivial scalar, flat object, recursive
  `$ref`, `oneOf`+`allOf` composition, large array of small objects).
  Measures both `compile` and `validate`; validate has separate valid
  / invalid tasks so neither library wins by short-circuiting. Uses
  [tinybench](https://github.com/tinylibs/tinybench) for
  warmup-plus-iterations statistics.

- **`--spec=<path>` (real-world).** Loads the given OpenAPI entry via
  [`@apidevtools/json-schema-ref-parser`](https://github.com/APIDevTools/json-schema-ref-parser)
  (to keep the input identical across all three libraries), extracts
  every unique request- and response-body schema, and times each
  library's compile across the whole set with plain
  `performance.now()`. Validate is skipped in this mode: real-world
  schemas don't come with paired valid/invalid fixtures, so there's
  no honest apples-to-apples way to measure it here. Use the
  synthetic mode if you need validate throughput numbers.

Output lands on stdout and as JSON at `./results.json`.

### `bench-real-world.mjs` — oav end-to-end on one spec

```bash
pnpm build                                      # dist/ needs to exist
node performance/bench-real-world.mjs <spec> [...more]
```

Not a library comparison. Runs oav's full OpenAPI pipeline on one or
more specs and reports:

- oav `loadSpec` duration (or FAIL + error when it throws)
- `@apidevtools/json-schema-ref-parser` duration for comparison
- `createValidator` construction
- `validateRequest` cold-path median + max across ~50 sampled ops
- hot-path median after caches are warm
- heap usage

Use it to sanity-check a new spec loads end-to-end through oav, or to
regression-check when you touch `@oav/spec` / `@oav/validator`.

## Which entry point when

| You want to know...                                                    | Use                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Is oav competitive with ajv / hyperjump on shape X?                    | `run.ts` (synthetic, pick the matching schema in `schemas.ts` or add one) |
| How does library choice scale across a real spec's schemas?            | `run.ts --spec=<path>`                                                    |
| Does this real spec load cleanly through oav's pipeline?               | `bench-real-world.mjs`                                                    |
| How long does oav take from spec-on-disk to "first validated request"? | `bench-real-world.mjs`                                                    |

## Reading the results

### Synthetic mode

```
=== petstore — flat object with bounds and formats ===
compile:
  ajv compile                  402 ops/s       2.49ms / op
  hyperjump compile           5.8K ops/s     172.36µs / op
  oav compile                26.7K ops/s      37.60µs / op
validate:
  ajv validate (valid)              25.0M ops/s      39.95ns / op
  ...
```

Per-library line per task. `ops/s` is tinybench's measured throughput,
`/ op` is mean latency per call. Bigger ops/s = faster. The relative
table at the end normalises against ajv as baseline.

### Spec mode

```
=== Real-world spec: path/to/openapi.yaml ===
277 unique request/response body schemas.
compile (per library, aggregated across every schema):
  ajv         total  3858.40ms   mean    13.93ms   p95    41.17ms   max    54.78ms
  hyperjump   total  1337.84ms   mean     4.83ms   p95    17.01ms   max    22.35ms
  oav         total    336.77ms   mean     1.22ms   p95     3.86ms   max     5.92ms
```

- `total` is wall-clock time to compile every body schema in the spec.
- `mean`, `p95`, `max` describe per-schema distribution.
- Any schemas that fail to compile are counted separately and a
  sample of their error messages is printed below the table (a
  library that rejects an OAS 3.0-specific keyword like `nullable`
  will show up here; that's a real property of the library, not a
  benchmark artifact).

### Note on `validate` under `--spec`

Deliberately omitted. Without paired valid/invalid fixtures per
schema, any choice of synthetic input (`{}`, an example mined from
the spec, a type-driven synthesised value) would favour one library's
fast-path over another in ways that don't reflect real workloads. If
you need validate throughput numbers on real shapes, copy the
relevant body schema into `schemas.ts` with hand-authored inputs and
run the synthetic mode.

## Methodology

**Compile (synthetic).** Each hot-loop iteration is only the
library's work:

- **ajv**: `new Ajv({allErrors, strict:false}).compile(schema)`. The
  instance construction stays in — it's part of the cold-start cost
  for a consumer that doesn't already have an Ajv around.
- **hyperjump**: `registerSchema(schema, uri)` then `await validate(uri)`
  then `unregisterSchema(uri)`. URIs come from a pre-generated pool
  so no string construction is in the hot loop; the unregister keeps
  registry size bounded.
- **oav**: `compileSchema(schema, opts)` with pre-built `opts`.

**Compile (spec mode).** Same per-library semantics, one iteration
per schema. Hyperjump gets an explicit `https://json-schema.org/draft/2020-12/schema`
dialect URI passed to `registerSchema` (spec-derived schemas don't
carry `$schema`). Ajv runs with `logger: false` so OAS-specific
format warnings don't flood stdout.

**Validate (synthetic).** Every library pre-compiles its validator
once, outside the timed loop. The hot path is literally
`validator(sample)` — no closures, no cursor math, no per-iteration
setup. One representative sample each for the valid and invalid
paths so neither side wins by short-circuiting. `allErrors: true` on
ajv for parity with oav's always-collect-everything default.

## Interpreting the results

- **Compile-hot workloads.** Per-request or per-tenant validator
  construction. oav wins across the board in the current numbers,
  by one to two orders of magnitude against ajv.
- **Steady-state validate on the same payload shape.** Call
  `compile` once at boot, validate many times. ajv is the fastest
  here; oav is roughly 1.4× on trivial shapes, ~3× on object and
  composition shapes, ~3× on large-array shapes. `maxErrors: 1`
  closes the ajv gap on invalid payloads (apples-to-apples with
  ajv's default fail-fast behaviour).
- **Predicate mode (`predicate: true`).** When consumers only need a
  yes/no answer — routing, gating, hot-path filtering — `oav-predicate`
  brings oav onto parity with ajv's default (fail-fast) mode on invalid
  paths and typically edges it out on valid paths. The compiler drops
  error-tree construction entirely: no leaf-allocation, no path
  snapshot, no params object, no message string, no wrapper. Every
  failure short-circuits to `return false;`. The mode cannot be
  combined with `maxErrors` (the two options are semantically
  incompatible; the compiler throws).
- **Hyperjump**'s validate throughput sits roughly two orders of
  magnitude below ajv / oav. It's the 2020-12 reference
  implementation, not a speed target.
- **`@oav/schema`**'s remaining validate overhead vs ajv comes from
  two structural choices: schemas that contain applicators
  (`properties` / `items` / `allOf` / ...) compile to a function
  call rather than inlining into the enclosing body (V8 monomorphises
  hot-loop calls better than massive inline bodies); and oav collects
  complete error trees by default, while ajv defaults to
  `allErrors: false`. Set `maxErrors: 1` on oav for apples-to-apples
  fast-fail semantics, or `predicate: true` to shed the error
  infrastructure entirely.

## Results file

Raw numbers land in `./results.json` after every run. Format:

```ts
type Result = {
  schema: string; // schema name or spec path
  metric: "compile" | "validate";
  lib: "ajv" | "ajv-fast" | "hyperjump" | "oav" | "oav-predicate";
  hz: number; // ops/sec
  mean: number; // µs per op
  variant?: string; // e.g. "oav-predicate validate (valid)"
};
```

Each run overwrites the previous file.
