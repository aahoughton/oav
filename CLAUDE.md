# CLAUDE.md — project-internal notes for contributors using Claude Code

## Build commands

```bash
pnpm install
pnpm build                        # tsup: single multi-entry bundle (ESM + CJS + .d.ts)
pnpm test                         # vitest for everything
pnpm vitest run packages/schema   # run a single package's tests (path filter)
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
- **`@oav/router`** — a sorted-list route matcher. Routes are sorted once
  at construction (more-literal segments first); `match` is a linear scan,
  O(routes × segments). Cheap for typical OpenAPI spec sizes.
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
               → spec → core
               → formats → core
               → schema → core
               → core
     → spec → core
     → core
```

## How to add a new keyword

1. Create `packages/schema/src/keywords/<area>.ts` exporting a
   `KeywordDefinition` with `keyword`, `vocabulary`, `compile(ctx)`.
   Flags on the definition itself drive compiler specialisation —
   set them correctly or performance optimisations silently mis-fire:
   - `applicator: true` — keyword descends into subschemas (items,
     properties, allOf, not, …). Drives the inliner to use the
     function-call path for multi-keyword schemas containing this
     keyword. A missed flag costs correctness (inlined applicators can
     skip per-function evaluated-keys state) and speed (V8 can't
     monomorphise a huge inline body).
   - `annotation: true` — keyword is metadata only, emits no runtime
     code (`title`, `description`, `$id`, `$schema`, `$comment`, …).
     Lets the inliner count keyword density correctly and avoids
     spurious "unknown-keyword" diagnostics.
   - `evaluates: { properties?: true; items?: true }` — keyword
     contributes to evaluated-keys / evaluated-items tracking for
     `unevaluated*`.

   `ctx.predicate` is `true` when the user requested predicate mode
   (`compileSchema(..., { predicate: true })`). Most keywords don't
   need to read this — `ctx.emitError`, `ctx.leafErrorExpr`,
   `ctx.validateSubschema`, and `ctx.emitBudgetBreak` all do the
   right thing automatically. Branch on it only when your keyword
   reads a sub-validator's return value (composition keywords,
   `$ref`, `contains`, `discriminator`, `dependentSchemas`); see the
   "Predicate mode" section below.

   The context (`KeywordCompileContext`) offers:
   - `ctx.gen` — code emitter (see the `CodeEmitter` interface).
   - `ctx.data`, `ctx.path`, `ctx.errors` — JS expressions for the
     current data, path array, and error accumulator.
   - `ctx.schema`, `ctx.parentSchema` — the keyword's value and the
     surrounding schema object.
   - `ctx.emitError(kind, expr)` / `ctx.errorStatement(kind, expr)` —
     push an error expression (`"leaf"` = counts against `maxErrors`,
     `"lift"` = propagating an already-counted sub-validator result).
   - `ctx.leafErrorExpr(codeExpr, msgExpr, paramsExpr, extraSegments?)`
     — build a `deps.createLeafError(...)` call. Pass any per-error
     trailing path segment (e.g. a missing property name) via
     `extraSegments` so the runtime helper splices them; the helper
     also picks up any segments pending from an enclosing inlined
     `validateSubschema` call. `ctx.branchErrorExpr(...)` is the
     equivalent for branch errors.
   - `ctx.validateSubschema(schema, dataExpr, { segment? })` — the
     common "descend into a subschema" pattern (inlines when simple).
   - `ctx.compileSubschema(schema) -> fnName` — lower-level; use when
     a keyword needs the sub-validator's return value for its own
     logic (composition keywords do this).
   - `ctx.resolveRef(ref)`, `ctx.evaluatedPropertiesVar` /
     `ctx.evaluatedItemsVar` — for `$ref` and unevaluated-tracking.
   - `ctx.effectivePathExpr` — JS expression for the runtime path
     including any pending inline segments. Reach for this only when
     passing the path to something other than the error helpers
     (e.g. a user-supplied custom-keyword callback).
   - `ctx.emitBudgetBreak()` at the tail of hot loops.

2. Add it to the vocabulary's `keywords` array in `vocabulary.ts`.
3. Re-export from `keywords/index.ts` and top-level `src/index.ts`.
4. Add a `test/keyword-<name>.test.ts` that compiles a schema, validates
   good + bad data, and asserts on `code` / `path` / `params` /
   `children` structure — never on generated code strings.
5. Add an entry to `BuiltInErrorParams` in `packages/core/src/errors.ts`
   describing the new error `code` and the shape of its `params`
   object. The compiler can't check this (errors are emitted through
   generated JS source), but it's the documented contract consumers
   narrow against — drift here is a silent bug.

## How to add a new format

1. Add the validator to `packages/formats/src/<area>.ts`.
2. Export from `packages/formats/src/index.ts`.
3. Add it to the `builtInFormats` record.
4. Test with RFC-sourced valid + invalid examples.

## How to add a new output format

Output format dispatch lives in `@oav/core` (not the CLI) so library
consumers can render by format name too. Programmatic callers can also
pass a renderer function directly — `formatError(err, (e) => ...)` —
without forking the switch.

1. Add the name to `KNOWN_OUTPUT_FORMATS` in
   `packages/core/src/format-output.ts` — the `OutputFormat` type and
   the CLI's Commander `--format` validator are both derived from it.
2. Add the rendering function to `packages/core/src/format.ts` (or emit
   straight from the leaves).
3. Add a branch to `formatError()` in `packages/core/src/format-output.ts`.
4. Add a test in `packages/core/test/format-output.test.ts`.

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

The budget semantics show up at the keyword-authoring level through
the `kind` argument on `ctx.emitError` / `ctx.errorStatement`:

- `ctx.emitError("leaf", expr)` — a **fresh leaf error**; counts
  against the budget. Use when the keyword itself is constructing a
  `createLeafError(...)` expression.
- `ctx.emitError("lift", expr)` — a **lift**: propagating a
  sub-validator's already-counted error up the tree, or wrapping
  already-counted children in a `createBranchError`. Always
  unconditional.

Using the wrong kind silently miscounts errors against the budget.
The `kind` is a required argument — TypeScript enforces that a choice
is made at every call site; the correctness of the choice is on the
author.

### Predicate mode (`compileSchema(schema, { predicate: true })`)

For consumers who only need a yes/no answer (routing, gating,
bulk-filtering), `predicate: true` compiles a `{ validate: (data) =>
boolean }` validator. No error tree is ever constructed: leaves don't
allocate, paths aren't snapshotted, messages aren't formatted, and the
entire `wrapErrors` pipeline is skipped. Every failure short-circuits
to `return false;`. Generated subfunctions drop the `path` parameter
(there's nothing to attach errors to).

Predicate mode is mutually exclusive with a finite `maxErrors`; the
compiler throws if both are set. The two options are semantically
incompatible — predicate already short-circuits on the first failure,
so there is nothing to count.

For **keyword authors**, most keywords get predicate mode for free
because `ctx.emitError("leaf" | "lift", expr)` collapses to `return
false;` when `ctx.predicate === true`; `ctx.withPathSegment`,
`ctx.validateSubschema`, and `ctx.emitBudgetBreak` are similarly
predicate-aware. You only need to branch on `ctx.predicate` when your
keyword reads a sub-validator's return value for its own control flow
— composition keywords (`allOf`, `anyOf`, `oneOf`, `not`,
`if`/`then`/`else`, `dependentSchemas`), `contains`, `discriminator`,
`$ref`, and `$dynamicRef` all do this. In predicate mode subfunctions
return `boolean` (not `ValidationError | null`) and don't take a
`path` argument, so the call expression shape changes accordingly.
See `allOfKeyword` in `packages/schema/src/keywords/composition.ts`
for the canonical two-branch pattern.

## Version support

`@oav/validator` buckets the spec's `openapi` string at validator
construction time via `detectOpenAPIVersion` and picks a dialect:

| Spec version | Status    | Dialect                            |
| ------------ | --------- | ---------------------------------- |
| 3.0.x        | Supported | OAS 3.0 Schema Object flavour      |
| 3.1.x        | Supported | JSON Schema 2020-12                |
| 3.2.x        | Supported | JSON Schema 2020-12 + QUERY method |

Dispatch is a one-liner inside `createValidator` — `dialectFor(version)`.
The check runs once at construction; there's no per-request branching,
so adding more versions adds zero runtime cost.

### What differs in the 3.0 dialect

Only three things vary from 2020-12; everything else (numeric / string
/ array / object bounds, `enum`, `required`, `allOf`/`anyOf`/`oneOf`,
`not`, `format`, discriminator, etc.) is shared.

1. **`type` is string-only** (no arrays). `oas30TypeKeyword` enforces
   this at compile time and adds `"null"` to the acceptable types when
   the sibling `nullable: true` is set.
2. **`exclusiveMaximum` / `exclusiveMinimum` are booleans**. They
   modify the sibling `maximum` / `minimum` rather than standing alone
   as numeric bounds. `oas30MaximumKeyword` / `oas30MinimumKeyword`
   read the boolean and emit `>=` vs `>` (or `<=` vs `<`) accordingly.
3. **`$ref` siblings are ignored**. The dialect's
   `rules.refSuppressesSiblings` flag makes the keyword dispatcher
   skip every non-`$ref` keyword in a schema that declares `$ref`.
   `oas30Dialect` sets it to `true`; every other built-in dialect
   sets it to `false`.

Keywords not present in 3.0 (`const`, `if`/`then`/`else`, `contains`,
`patternProperties`, `propertyNames`, `unevaluatedProperties`/`Items`,
`prefixItems`, `$defs`, `$id`, anchors, `$dynamicRef`) are simply not
in the 3.0 vocabulary stack — schemas that use them are treated as
having an unknown field, which 2020-12 allows in every dialect.

### Running tests per version

- **Schema-level tests** (`packages/schema/test/*`) are
  dialect-agnostic — they compile schemas with the default 2020-12
  vocab and assert on 2020-12 semantics. Dialect-specific keyword
  tests sit next to their keyword files where sensible.
- **HTTP-level conformance** lives in
  `conformance/openapi-cases/petstore-{30,31,32}/` — one petstore per
  version, each exercising the version's distinctive features (3.0:
  `nullable`, boolean `exclusiveMinimum`; 3.2: QUERY method).
- **Validator integration tests** in
  `packages/validator/test/versioning.test.ts` cover dispatch,
  dialect-specific keyword behaviour, and the `dialect` override.

## Known limitations

- `$dynamicRef` currently behaves like `$ref` with an anchor lookup — no
  runtime dynamic-scope traversal. Good enough for schemas that don't
  actually rewire the extension point at runtime.
- `unevaluated*` evaluated-key tracking is gated at compile time on
  a one-pass walk of the root schema and any registered external
  schemas. If nothing uses `unevaluatedProperties` / `unevaluatedItems`,
  the compiler suppresses the per-function `evalProps` / `evalItems`
  Sets and the merge loop that threads them up to the caller.
  See `CompileState.unevaluatedTracking` and `schemaUsesUnevaluated`
  in `packages/schema/src/compiler/compiler.ts`.
