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
| tiny        | 3.95ms | 41.44µs   | 6.77µs  |
| petstore    | 2.98ms | 208.43µs  | 32.48µs |
| tree        | 2.96ms | 176.82µs  | 26.18µs |
| composition | 3.18ms | 408.57µs  | 60.71µs |
| array-heavy | 2.96ms | 165.23µs  | 27.88µs |

Validate — ajv wins; its fused-codegen validators are ~2-14× faster
than ours on composition and large arrays. oav is competitive on
simple scalars and trees and consistently faster than hyperjump.

| schema      | ajv    | hyperjump | oav     |
| ----------- | ------ | --------- | ------- |
| tiny        | 46ns   | 207ns     | 43ns    |
| petstore    | 107ns  | 1.31µs    | 267ns   |
| tree        | 147ns  | 2.16µs    | 215ns   |
| composition | 96ns   | 2.37µs    | 411ns   |
| array-heavy | 1.09µs | 243.93µs  | 17.07µs |

(Numbers drift run-to-run; use `results.json` for the raw series.)

## Methodology notes

Each per-iteration hot path is meant to contain only the library's
work. In particular:

- **ajv** — each iteration does `new Ajv({allErrors, strict:false}).compile(schema)`.
  The `new Ajv()` stays in because it's part of the cold-start cost for
  a code path that doesn't already have an Ajv instance on hand; ajv's
  own recommendation is to keep one instance and compile many schemas,
  which this bench doesn't model.
- **hyperjump** — each iteration does `registerSchema(schema, uri)` +
  `await validate(uri)` + `unregisterSchema(uri)`. URIs come from a
  pre-generated pool so string construction isn't inside the hot loop;
  unregister keeps registry size bounded so we don't measure a
  degrading-with-registry-size curve. Tried both with and without
  unregister; the difference is small (≤ 15%) and either is defensible.
- **oav** — each iteration does `compileSchema(schema, opts)` with a
  pre-built `opts` object.

Validate benchmarks compile once outside the timed region and call the
resulting function on a rotating mix of valid and invalid inputs, so
neither the pass nor fail path is skipped.

## Reading the results

- If your workload compiles schemas hot (per-request, per-tenant, etc.),
  oav is the clear win — it's ~90-460× faster to compile than ajv and
  ~7-17× faster than hyperjump.
- If your workload is steady-state validation of the same compiled
  schema over many payloads, ajv is the clear win. The largest gap is
  on `array-heavy` (14×) where ajv's inline loop avoids our per-item
  function-call overhead.
- Hyperjump is the reference implementation for spec correctness (it's
  the same team that publishes the JSON Schema Test Suite), but pays
  for that in runtime overhead.

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
