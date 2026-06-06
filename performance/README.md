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
  `$ref`, `oneOf`+`allOf` composition, large array of small objects,
  `uniqueItems` array, and an object with large length-bounded
  strings). Measures both `compile` and `validate`; validate has separate valid
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
  no apples-to-apples way to measure it here. Use the
  synthetic mode if you need validate throughput numbers.

Output lands on stdout and as JSON under `./results/<iso-timestamp>.json`
(see [Results file](#results-file)).

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

### `mem.ts` — steady-state memory under HTTP load

```bash
# One-time bootstrap (builds oav, installs both server fixtures):
pnpm --filter=. build          # from repo root
cd performance/mem-bench && pnpm install
cd ..

pnpm bench:mem                                      # default 100 × 500 = 50,000 requests
BATCHES=20 PER_BATCH=500 WARMUP=250 pnpm bench:mem  # quick smoke
```

Spawns two Express 4 servers — one wraps `oav`, the other
wraps `express-openapi-validator` (which pulls in ajv). Both validate
a ~40-schema OpenAPI spec with discriminated payment-method unions,
nested address + amount objects, and array-of-items transfers. The
driver fires a round-robin mix of 13 request cases (valid + invalid
POST/GET/404/405 across five endpoints), forcing GC between samples
via each server's `/__memory?gc=1` endpoint, and reports baseline /
post-warmup / steady-state / post-idle RSS + heapUsed.

Use it to compare library footprint in a real HTTP backend shape, or
to regression-check when you change validator construction or cache
retention.

## Which entry point when

| You want to know...                                                    | Use                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Is oav competitive with ajv / hyperjump on shape X?                    | `run.ts` (synthetic, pick the matching schema in `schemas.ts` or add one) |
| How does library choice scale across a real spec's schemas?            | `run.ts --spec=<path>`                                                    |
| Does this real spec load cleanly through oav's pipeline?               | `bench-real-world.mjs`                                                    |
| How long does oav take from spec-on-disk to "first validated request"? | `bench-real-world.mjs`                                                    |
| What's the steady-state memory cost of each library in an HTTP server? | `mem.ts`                                                                  |

## Reading the results

### Synthetic mode

```
=== petstore — object with required + scalar properties; realistic small API payload ===
compile:
  ajv compile                  356 ops/s       2.85ms / op
  hyperjump compile           5.9K ops/s     189.94µs / op
  oav compile                17.1K ops/s      67.49µs / op
validate:
  ajv validate (valid)              23.7M ops/s      42.95ns / op
  ...
```

Per-library line per task. `ops/s` is tinybench's measured throughput,
`/ op` is mean latency per call. Bigger ops/s = faster. The relative
table at the end normalizes against ajv as baseline.

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

### Memory mode (`mem.ts`)

```
=== Steady-state memory: 100 × 500 = 50000 reqs ===

metric                                 oav       eov+ajv   Δ (eov-oav)
------------------------------------------------------------------------
baseline  RSS                       77.0MB       108.9MB        31.9MB  (-29%)
baseline  heapUsed                   8.8MB        12.1MB         3.3MB
warmup    RSS                       83.4MB       111.6MB        28.2MB
warmup    heapUsed                  11.5MB        14.4MB         2.9MB
steady    RSS (avg last 5)          98.3MB       117.1MB        18.8MB  (-16%)
steady    heapUsed (avg)            11.9MB        14.6MB         2.7MB
postIdle  RSS                       98.3MB       117.1MB        18.8MB
postIdle  heapUsed                  11.9MB        14.6MB         2.7MB
growth    RSS                       14.9MB         5.5MB        -9.4MB
growth    heapUsed                   0.5MB         0.3MB        -0.2MB

batch throughput (avg ms per 500-req batch): oav 75ms, eov 80ms
```

What to look at:

- **`baseline RSS`** — the library + validator-set footprint at rest,
  right after `app.listen`. Stable across runs; typically eov+ajv is
  ~30 MB higher than oav on the bench spec.
- **`steady heapUsed`** — V8 heap after 50k requests with GC forced
  before each sample. Stable; typically eov+ajv is ~2.5–3 MB higher
  (~15–20%).
- **`growth` rows** — delta from post-warmup to end-of-run. Both
  libraries plateau; if either grows without bound the value here
  diverges and the steady rows keep rising across runs.
- **`steady RSS`** is noisier than heapUsed — V8 expands the heap in
  chunks, and when a chunk boundary falls mid-run the final RSS
  differs by 10–15 MB between runs even though the actual working
  set is stable. The heapUsed number is the cleaner signal for
  retention; RSS is what the OS accountancy shows and includes V8's
  uncommitted-but-reserved pages.
- **Status-code distribution** is printed above the table; both
  servers should agree on every batch. A mismatch means the
  validators diverge on some request shape and the comparison is
  invalid.

Raw per-batch data lands in `results/mem-<timestamp>.json`.

### Note on `validate` under `--spec`

Deliberately omitted. Without paired valid/invalid fixtures per
schema, any choice of synthetic input (`{}`, an example mined from
the spec, a type-driven synthesized value) would favor one library's
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
  `compile` once at boot, validate many times. ajv and oav trade the
  lead by shape:
  - **At or near ajv parity** on scalar, flat-object, and recursive
    `$ref` shapes (within ~10–35% on the bench spec).
  - **Behind ajv** on the applicator-heavy shapes: ~2–3× on large
    arrays, ~3–4× on `oneOf`/`allOf` composition (the largest
    remaining gap; see the structural note below). Predicate mode
    closes most of the composition gap.
  - **Ahead of ajv** on two shapes: `uniqueItems` arrays (oav's
    primitive fast path vs ajv's pairwise scan), and length-bounded
    strings. On the latter, `minLength` / `maxLength` decide from the
    string's `.length` before walking code points, so a large valid
    body costs O(1) where ajv walks the whole string (oav is
    ~thousands× faster on that shape's valid path).

  `maxErrors: 1` closes the gap on invalid payloads (apples-to-apples
  with ajv's default fail-fast behavior).
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
  call rather than inlining into the enclosing body (V8 monomorphizes
  hot-loop calls better than massive inline bodies); and oav collects
  complete error trees by default, while ajv defaults to
  `allErrors: false`. Set `maxErrors: 1` on oav for apples-to-apples
  fast-fail semantics, or `predicate: true` to shed the error
  infrastructure entirely.

## Results file

Each run writes `./results/<iso-timestamp>.json`. The `results/` directory is
gitignored — benchmark numbers depend on the host machine, so committing them
across contributors would be misleading. Compare runs locally instead, or roll
back to a commit and re-run.

Format:

```ts
type RunOutput = {
  meta: {
    timestamp: string; // ISO 8601
    commitSha: string;
    nodeVersion: string;
    timePerTaskMs: number;
    mode: "synthetic" | "spec";
  };
  results: Result[];
};

type Result = {
  schema: string; // schema name or spec path
  metric: "compile" | "validate";
  lib: "ajv" | "ajv-fast" | "hyperjump" | "oav" | "oav-predicate";
  hz: number; // ops/sec
  mean: number; // µs per op
  variant?: string; // e.g. "oav-predicate validate (valid)"
};
```
