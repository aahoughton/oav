# @oav-dev/performance

Cross-library benchmarks for `@oav/schema` vs
[ajv](https://github.com/ajv-validator/ajv) (2020 dialect) and
[@hyperjump/json-schema](https://github.com/hyperjump-io/json-schema)
(2020-12 first-class).

This is a **standalone package** inside the monorepo — its deps (ajv,
hyperjump, tinybench, tsx) are declared here, not in the main workspace,
so `pnpm install` at the repo root stays lean.

## Bootstrap and run

```bash
cd performance
pnpm install            # one-time
pnpm bench              # all schemas, default 500ms per task
pnpm bench:long         # all schemas, 1.5s per task (steadier numbers)
pnpm bench -- --filter=petstore   # a single schema
pnpm bench -- --time=250          # quick smoke
```

Each schema is benchmarked on two axes:

- **compile**: cold-start cost (codegen / eval / meta-validation for
  libraries that do it). Measures how much you pay the first time a
  schema is loaded.
- **validate**: steady-state invocation of a pre-compiled validator,
  alternating over a mix of valid and invalid inputs.

The five schemas in `schemas.ts` try to cover the realistic shape
distribution: a trivial scalar (overhead baseline), a petstore-style
flat object, a recursive `$ref`, `oneOf` + `allOf` composition, and a
large array of small objects.

## Latest run (Node 22, developer laptop, `--time=500`)

Compile — oav wins across the board; ajv's meta-schema validation costs
milliseconds on every compile.

| schema      | ajv    | hyperjump | oav     |
| ----------- | ------ | --------- | ------- |
| tiny        | 2.97ms | 37.47µs   | 10.85µs |
| petstore    | 2.98ms | 204.46µs  | 54.48µs |
| tree        | 2.94ms | 170.57µs  | 40.67µs |
| composition | 3.43ms | 434.86µs  | 87.62µs |
| array-heavy | 2.88ms | 163.39µs  | 42.54µs |

Validate (happy path — pre-compiled validator, one valid input per
iteration, no per-iteration setup):

| schema      | ajv    | hyperjump | oav    |
| ----------- | ------ | --------- | ------ |
| tiny        | 24.3ns | 226.3ns   | 25ns   |
| petstore    | 62.9ns | 1.05µs    | 172ns  |
| tree        | 50.2ns | 631.3ns   | 72ns   |
| composition | 69.7ns | 2.38µs    | 242ns  |
| array-heavy | 1.08µs | 240.35µs  | 3.54µs |

Validate (failure path — pre-compiled validator, one invalid input per
iteration):

| schema      | ajv    | hyperjump | oav    |
| ----------- | ------ | --------- | ------ |
| tiny        | 35.1ns | 191.3ns   | 50ns   |
| petstore    | 82.9ns | 798.0ns   | 235ns  |
| tree        | 78.2ns | 620.0ns   | 81ns   |
| composition | 89.3ns | 2.02µs    | 321ns  |
| array-heavy | 1.14µs | 244.84µs  | 3.63µs |

(Numbers drift run-to-run; use `results.json` for the raw series.)

## Changes since the first measurement

Three optimisations landed as distinct commits, each with its own
rigorous test suite:

**1. Single-keyword subschema inlining.** When an applicator
dispatches to a subschema containing exactly one leaf keyword from a
safe whitelist, the keyword's code is emitted directly into the
enclosing function.

- tree: 77 → 63 ns (+19%)
- array-heavy: 16.12 → 9.32 µs (+42%)

**2. Shared mutable path array.** Generated validators used to build
a fresh `[...path, seg]` per sub-call, even on the happy path. Now
the path variable is a single mutable array that gets pushed on
descent and popped on ascent. Error-creation helpers snapshot the
path at commit time, so errors retain correct paths regardless of
later push/pop unwind. 11 new rigorous tests in
`path-sharing.test.ts` catch the dangerous cases (live-reference
corruption, missing pop, sibling interference).

- array-heavy: 9.32 → 3.69 µs (+60%)
- composition: 321 → 242 ns (+25%)

**3. Multi-keyword leaf subschema inlining.** Subschemas with
multiple leaf keywords (`{type: "integer", minimum: 1}`, etc.) now
inline too. Tree shape preserved via errors-array-length
snapshot + conditional `schema`-branch wrap. Applicator-containing
schemas (e.g., `{type: "object", properties: ...}`) stay as
functions — V8 monomorphises hot-loop function calls better than
it optimises massive inlined loop bodies.

- petstore: 189 → 172 ns (+9%)
- composition: 243 → 242 ns (neutral)
- array-heavy: 3.69 → 3.54 µs (+4%)

**Attempted-and-reverted**: a "deferred path" variant that passed
`[...path, seg]` as the literal path expression to single-keyword
inlines, skipping the push/pop. Gained 10% on array-heavy but lost
25% on composition — plausibly V8 de-optimised the surrounding
function. Reverted.

Cumulative vs pre-optimisation baseline:

- tiny: 43ns → 25ns (+42%)
- petstore: 267ns → 172ns (+36%)
- tree: 215ns → 72ns (+67%)
- composition: 410ns → 242ns (+41%)
- array-heavy: 16.05µs → 3.54µs (+78%, 4.5× faster)

Compile got ~50% slower (from ~20µs → ~45µs on realistic schemas)
because the context threads more state through every dispatch.
Still 60–300× faster than ajv to compile.

## Methodology notes

**Compile** — each per-iteration hot path is only the library's work:

- **ajv** — `new Ajv({allErrors, strict:false}).compile(schema)`. The
  `new Ajv()` stays in because it's part of the cold-start cost for a
  path that doesn't already have an Ajv instance to reuse.
- **hyperjump** — `registerSchema(schema, uri)` +
  `await validate(uri)` + `unregisterSchema(uri)`. URIs come from a
  pre-generated pool so no string construction is in the hot loop; the
  unregister keeps registry size bounded.
- **oav** — `compileSchema(schema, opts)` with a pre-built `opts`.

**Validate** — every library pre-compiles its validator ONCE outside
the timed region. The hot path is literally `validator(sample)` — no
closures, no cursor math, no modulo, no per-iteration I/O. This
measures the pre-spec-loaded "I got a JSON, how fast can I check it"
cost, which is the production workload we care about.

The happy-path and failure-path numbers are separate rows so neither
side wins by short-circuiting. Both use `allErrors: true` on ajv for
parity.

## Reading the results

- If your workload compiles schemas hot (per-request, per-tenant, etc.),
  oav is the clear win — ~55–300× faster than ajv, ~4–13× faster than
  hyperjump.
- If your workload is steady-state validation of the same compiled
  schema over many payloads (the most common production case), ajv
  wins. The gap is tight on trivial / tree shapes (~1–1.4×), moderate
  on real objects (~3×) and composition (~3.5×), and largest on big
  nested arrays (~3.3× after the perf work — was 15× before).
- Hyperjump is the reference implementation for spec correctness, not
  the speed king — expect 5–200× slower validate than ajv depending on
  schema shape.
- For very large payloads where every item fails the same way,
  `maxErrors` (or `maxErrors: 1` for fast-fail) turns an O(n) scan
  into O(cap). Measured: 100k bad items in a 10-MB array goes from
  ~64 ms uncapped to ~0.1 ms with `maxErrors: 10`.

## Where oav's remaining validate overhead comes from

Two structural reasons ajv still wins on validate:

1. **Function-per-schema for applicator-containing subschemas.**
   Leaf subschemas (single or multi-keyword) now inline. But any
   schema containing `properties`/`items`/`allOf`/etc. still
   compiles to a function — V8 monomorphises that hot-loop call
   well, and trying to inline an applicator body into a 100-iter
   loop blew up the caller's code size past what V8 optimises.
   Ajv inlines everything under one top-level schema and accepts the
   compile-time cost.
2. **Always-all-errors by default.** oav collects complete error
   trees out of the box; ajv defaults to `allErrors: false` (first
   error wins). The bench sets `allErrors: true` on ajv for parity,
   but ajv's codegen is shaped for early-exit. oav's `maxErrors`
   opt-in closes this gap when the caller can tolerate partial
   reports — `maxErrors: 1` is apples-to-apples with ajv's default
   mode.

Levers we tried that didn't pan out:

- **Deferred path construction** — pass `[...path, seg]` as the
  literal path expression to single-keyword inlines, skipping the
  push/pop. Won 10% on array-heavy but lost 25% on composition.
  Reverted; see commit log for detail.

Levers we haven't attempted:

- **Specialised short-circuit for `items: { type: T }`** where the
  type predicate is a single compare against a pre-materialised
  predicate function. Would help the most trivial array shapes
  (e.g., `string[]`, `number[]`).
- **Sharing a single errors array across an applicator's branches**
  (`allOf` / `oneOf`), eliminating the per-branch `const errsVar =
[]` allocation. Small but free.
- **Per-call JIT warm-up** — repeatedly invoked validators tend to
  shake a few ns off after V8's tier-up. A documented "warm up the
  validator before measuring" note in any consumer's README.

None are required for correctness.
