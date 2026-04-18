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
| tiny        | 2.97ms | 37.47µs   | 10.21µs |
| petstore    | 2.98ms | 204.46µs  | 49.78µs |
| tree        | 2.94ms | 170.57µs  | 35.54µs |
| composition | 3.43ms | 434.86µs  | 80.54µs |
| array-heavy | 2.88ms | 163.39µs  | 38.36µs |

Validate (happy path — pre-compiled validator, one valid input per
iteration, no per-iteration setup):

| schema      | ajv    | hyperjump | oav    |
| ----------- | ------ | --------- | ------ |
| tiny        | 24.3ns | 226.3ns   | 24.5ns |
| petstore    | 62.9ns | 1.05µs    | 189ns  |
| tree        | 50.2ns | 631.3ns   | 63ns   |
| composition | 69.7ns | 2.38µs    | 321ns  |
| array-heavy | 1.08µs | 240.35µs  | 9.32µs |

Validate (failure path — pre-compiled validator, one invalid input per
iteration):

| schema      | ajv    | hyperjump | oav    |
| ----------- | ------ | --------- | ------ |
| tiny        | 35.1ns | 191.3ns   | 49.8ns |
| petstore    | 82.9ns | 798.0ns   | 243ns  |
| tree        | 78.2ns | 620.0ns   | 83ns   |
| composition | 89.3ns | 2.02µs    | 413ns  |
| array-heavy | 1.14µs | 244.84µs  | 8.81µs |

(Numbers drift run-to-run; use `results.json` for the raw series.)

## Changes since the first measurement

Single-keyword subschema inlining: when an applicator (items,
properties, additionalProperties, patternProperties, propertyNames,
unevaluatedProperties/Items) would otherwise call a subschema
function, and that subschema contains exactly one of a safe whitelist
of leaf keywords (type, const, enum, numeric/string bounds, pattern,
format, item/property counts, uniqueItems), the keyword's code is
emitted directly into the enclosing function. Avoids per-call function
dispatch and — more impactfully — the eager `[...path, seg]` path
array allocation that function boundaries otherwise force.

Numbers moved:

- **tree**: 77 → 63 ns (19% faster; recursive value/label get inlined,
  children still goes through a function for cycle handling).
- **array-heavy**: 16.12 → 9.32 µs (42% faster; the inner
  `tags: { type: "array", items: { type: "string" } }` gets its
  per-string validator inlined).
- tiny / petstore / composition essentially unchanged — those
  schemas either have no nested subschemas, or all subschemas have
  multiple keywords.

Compile got slightly slower (30–50% more time) because the context
now threads the keyword registry through every subschema compilation.
Still 50–300× faster than ajv to compile.

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
  oav is the clear win — ~90-460× faster than ajv, ~7-18× faster than
  hyperjump.
- If your workload is steady-state validation of the same compiled
  schema over many payloads (the most common production case), ajv
  wins. The gap is small on trivial shapes (~1×), modest on real
  objects and trees (~1.5-3×), and sizeable on composition and large
  arrays (4-15×).
- Hyperjump is the reference implementation for spec correctness, not
  the speed king — expect 5-200× slower validate than ajv depending on
  schema shape.

## Where oav's validate overhead comes from

Main two causes:

1. **Function-per-schema compilation.** Every subschema (every
   `properties[k]`, every `items`, every `oneOf` branch) is its own
   generated function. That's clean and makes `$ref` cycles free, but
   each call is a closure dispatch + array allocation for `path` /
   `errors`. Ajv inlines all of that into one function per top-level
   schema.
2. **Always-all-errors.** We never short-circuit on the first failure;
   the prompt requires complete error trees for HTTP validation. Ajv
   defaults to `allErrors: false` — I set `allErrors: true` in the
   bench (for parity) but even so its codegen was designed for early
   exit.

There are two levers we could pull to close the gap without giving up
the tree structure:

- **Inline simple leaf keywords** (type/minimum/maxLength/pattern) into
  the enclosing function instead of emitting a subschema call. Would
  mostly help petstore/array-heavy.
- **Reuse the same path array** across sibling validations in an
  applicator rather than allocating `[...path, i]` per item. Mostly
  helps array-heavy.

Neither are needed for correctness.
