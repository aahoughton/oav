# CLAUDE.md — project-internal notes for contributors using Claude Code

## Build commands

```bash
pnpm install
pnpm build                        # tsup each package (ESM + CJS + .d.ts)
pnpm test                         # vitest for everything
pnpm --filter=@oav/schema test    # run a single package's tests
pnpm lint                         # oxlint + oxfmt --check
pnpm fmt                          # oxfmt --write .
pnpm typecheck                    # tsc -b (composite project references)
```

`pnpm test` uses vitest with workspace aliases from `vitest.config.ts` so
tests run against `packages/*/src` directly — no need to build before
testing.

## Dev-only sub-packages (standalone; not in the workspace)

- `conformance/` — upstream JSON Schema Test Suite + OpenAPI case
  harness. `cd conformance && pnpm install` to bootstrap.
- `performance/` — ajv/hyperjump/oav benchmarks. `cd performance &&
pnpm install` to bootstrap.

Both have their own `package.json` + `pnpm-workspace.yaml` (with empty
`packages:` list so pnpm treats them as isolated roots). Their deps
(ajv, hyperjump, tinybench, tsx) are NOT in the main workspace install.

## Architecture, package by package

- **`@oav/core`** — pure types. `ValidationError` tree (children always an
  array), path segments as `(string | number)[]`, and four formatters
  (`formatText` / `formatJson` / `formatFlat` / `formatGithub`). Everything
  else depends on this.
- **`@oav/schema`** — the JSON Schema 2020-12 compiler. Walks a schema,
  dispatches each keyword via `KeywordDefinition.compile(ctx)`, assembles
  the generated JS source, and `eval`s it through `new Function(deps, src)`.
  Boolean schemas (`true`/`false`) are first-class. `$ref` uses an
  identity-keyed cache so self-recursive refs emit normal recursive calls.
- **`@oav/formats`** — pure string validators; exported as a `Record<string,
(s: string) => boolean>` suitable for `compileSchema`'s `formats` option.
- **`@oav/spec`** — `DocumentReader` abstraction (file/http/memory/composite)
  plus `resolveSpec()` which inlines external `$ref`s and leaves circular
  ones as internal refs. `applyOverlays()` handles the extension system.
- **`@oav/router`** — a trie-ish router. Sorted at construction so `match`
  is O(segments).
- **`@oav/validator`** — orchestrator. Pre-compiles every operation's
  parameter/body/response schemas, does content-type negotiation and
  parameter deserialization (style + explode), and returns a
  `ValidationError` tree. Subtrees returned from sub-validators are
  prefixed with the HTTP location (`body`, `query`, `header`, ...) via
  `prefixPath`.
- **`@oav/cli`** — thin commander wrapper. No business logic beyond arg
  parsing, I/O, and exit codes.

## Dependency graph (strictly enforced; no cycles)

```
cli → validator → router
               → spec → schema → core
               → formats → core
               → schema
               → core
     → spec
     → core
```

## How to add a new keyword

1. Create `packages/schema/src/keywords/<area>.ts` exporting a
   `KeywordDefinition` with `keyword`, `vocabulary`, `compile(ctx)`. Use
   `ctx.gen`, `ctx.data`, `ctx.path`, `ctx.errors` — nothing more (plus
   `ctx.subschema` / `ctx.resolveRef` for composition).
2. Add it to the vocabulary's `keywords` array in `vocabulary.ts`.
3. Re-export from `keywords/index.ts` and top-level `src/index.ts`.
4. Add a `test/keyword-<name>.test.ts` that compiles a schema, validates
   good + bad data, and asserts on `code` / `path` / `params` /
   `children` structure — never on generated code strings.

## How to add a new format

1. Add the validator to `packages/formats/src/<area>.ts`.
2. Export from `packages/formats/src/index.ts`.
3. Add it to the `builtInFormats` record.
4. Test with RFC-sourced valid + invalid examples.

## How to add a new CLI output format

1. Add a branch to `OutputFormat` in `packages/cli/src/format-output.ts`.
2. Add the rendering function to `packages/core/src/format.ts` (or emit
   straight from the leaves).
3. Add a branch to `formatError()`.
4. Add a test in `packages/cli/test/format-output.test.ts`.

## Error-collection modes

By default the compiler collects every error into a tree. For very
large payloads (think "10 MB JSON array where every element is wrong
the same way") that's wasted CPU and memory. `compileSchema(schema,
{ maxErrors: N })` — also exposed on `@oav/validator`'s
`createValidator` — caps the tree at N leaves and short-circuits the
hot loops once the budget is exhausted. `maxErrors: 1` is the classic
fast-fail mode; the returned `{ valid: false, error, truncated: true }`
tells consumers their report is partial. Codegen is specialised: when
`maxErrors` is left unset, the generated source is identical to before
(no budget checks, no `truncated` tracking) — zero overhead for
callers who don't opt in.

Two push helpers on the keyword-compile context reflect this:

- `ctx.pushError(expr)` — a **fresh leaf error**; counts against the
  budget.
- `ctx.liftError(expr)` — a **lift**: propagating a sub-validator's
  already-counted error up the tree, or wrapping already-counted
  children in a `createBranchError`. Always unconditional.

Using the wrong one double-counts errors against the budget.

## Version support

`@oav/validator` buckets the spec's `openapi` string at validator
construction time via `detectOpenAPIVersion`:

| Spec version | Status          | Dialect                         |
| ------------ | --------------- | ------------------------------- |
| 3.0.x        | NOT implemented | draft-Wright-00 (OAS 3.0 flavour) |
| 3.1.x        | Supported       | JSON Schema 2020-12             |
| 3.2.x        | Supported       | JSON Schema 2020-12 + QUERY method |

The dispatch is a one-liner inside `createValidator` —
`vocabulariesFor(version)`. The version check runs once at
construction; there is no per-request branching, so supporting more
versions adds zero runtime cost.

**Adding OpenAPI 3.0.x in the future**:

1. Write `packages/schema/src/keywords/oas30/*.ts` with the 3.0
   flavours of `type` (string-only, no arrays), `nullable`,
   `exclusiveMaximum`/`Minimum` (booleans on the bounds), and `$ref`
   (siblings ignored).
2. Export an `oas30Vocabulary` from `@oav/schema` that composes them
   with the existing `validationVocabulary` / `applicatorVocabulary`
   minus 2020-12-only keywords (`const`, `if`/`then`/`else`,
   `contains`, `patternProperties`, `unevaluatedProperties`,
   `unevaluatedItems`).
3. Update `vocabulariesFor("3.0")` in
   `packages/validator/src/validator.ts` to return those vocabularies.
4. Add `packages/validator/test/versioning.test.ts` cases for 3.0.
5. Add `conformance/openapi-cases/petstore-30/` — parallels the 3.1
   and 3.2 petstores.

Most of the validation vocabulary (numeric/string bounds, `enum`,
`maxLength`, `minLength`, `required`, `allOf`/`anyOf`/`oneOf`, `not`,
`format`, `maxItems`, `minItems`, etc.) can be reused as-is.

## Known limitations

- `unevaluatedProperties` / `unevaluatedItems` do not propagate evaluation
  sets across `allOf` / `anyOf` / `oneOf` boundaries; each subschema
  compiles as its own function. See the TSDoc on
  `unevaluatedPropertiesKeyword` for detail.
- `$dynamicRef` currently behaves like `$ref` with an anchor lookup — no
  runtime dynamic-scope traversal. Good enough for schemas that don't
  actually rewire the extension point at runtime.
