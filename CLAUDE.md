# CLAUDE.md: project-internal notes for contributors using Claude Code

## Contribution principles

How to make decisions when extending this repo. The mechanics
sections below cover _how_ to add a thing; this section is about
_whether_ and _what shape_.

### Surface tradeoffs honestly

When a design choice has real tradeoffs (fat vs thin adapter, mocks
vs integration tests, one PR vs many, opinionated default vs escape
hatch), say so. Recommend a lean. Defer the call rather than picking
silently. A half-articulated choice that survives review is harder
to revisit than one that was explicitly weighed. The point is the
surfacing, not the agonizing: options + lean + decision space, not
exhaustive analysis.

### Talk through design before drafting

For substantive new APIs (a new package, a non-trivial option
addition, a default-behavior shift), open the conversation before
writing code. Sketch the API shape, list open questions, recommend
defaults. The cost of one round-trip on the design saves several on
the implementation when an early choice would have wanted to be
different. For small fixes and obvious changes, just do it; judgment.

### Naming and consistency

Names that pair (`request`/`response`, `validateRequest`/`validateResponse`,
`Validator`/`ValidatorOptions`, `httpRequestFromExpress`/`httpRequestFromFetch`)
carry meaning beyond what each name says alone: a reader should be
able to predict one from the other. When you add a new symbol, look
for the sibling that should pair with it, even if you're only writing
one half today. Across-package symmetry is a feature: every adapter
package exports the same factory names with the same option shapes,
with only the framework-typed argument varying. Per-framework types
use framework-native names (`ExpressContext`, `FastifyContext`); names
that sit above the framework boundary stay identical everywhere.

If a name reads awkwardly in user code (`requestValidator(validator)`,
three "validator"s, three meanings), that's a signal to rename, not
to add a comment.

### Forward-compatible API shapes

Design v0 surfaces so v1 additions land as new exports / new options,
not changed semantics. The Express 4 adapter shipped with
`validateRequests` knowing future `validateResponses` would need to
share option names, the default renderer, and the context shape.
Picking those identifiers up front cost nothing; doing it after the
fact would have meant a breaking rename. When you can't tell whether
a new option will need to extend later, lean toward shapes that widen
additively (`select: "first" | "deepest" | { byCode }`, not
`byCodeOnly: boolean`).

### No magic

Prefer explicit docs warnings over silent runtime detection of common
gotchas. The Express adapter doesn't auto-detect missing
`express.json()`; the README flags it. Implicit fallbacks, surprise
behaviors, and "we'll figure out what you meant" all create debugging
dead ends. Better to error early with a clear message, or not at all
and let the user's own logic fail in a familiar way.

### Type as canonical contract

TSDoc on the type is the API reference. Prose docs (READMEs,
docs/integration.md) are recipes: worked examples that show how
the pieces compose, with backreferences to the type for the contract.
When adding a new option-bearing interface, lead its TSDoc with a
roadmap of the field groups so editor tooling surfaces the surface
on first read. When adding a recipe in docs/integration.md, include
a "see {type}" backreference so the reader knows where the source of
truth lives.

### Prose Style

LLM-like writing breaks reader flow. Readers familiar with the
patterns notice them, snap out of whatever they were absorbing, and
have to reset. Avoid the patterns for the reader's sake, not for
camouflage. Applies to docs, TSDoc, commit messages, PR descriptions,
and code comments. The big ones:

- **Em-dash.** Replace `—` with a period, comma, semicolon,
  parenthesis, or colon.
- **Contrastive negation.** "Not X, it's Y" / "not just X, but Y" /
  "this isn't a fix, it's a rewrite." Make the affirmative claim
  directly.
- **Filler and hedging.** Throat-clearers ("honestly," "frankly,"
  "essentially") and stacked hedges ("may," "might," "could
  potentially") read as AI; drop them. Different from substantive
  adverbial use, e.g. the "honestly" in "Surface tradeoffs honestly"
  above.
- **Over-promising vocabulary.** "Robust," "elegant," "powerful,"
  "seamless," "comprehensive," "delve," "leverage," "unlock."
  Substantiate concretely or drop.

Generated output (error messages, log lines, anything the code itself
emits) is ASCII-only, simple, and concise. Data passed through from a
spec or user input is unchanged.

### Scope discipline

One PR per logical concern. Tightly-coupled fixes bundle (the
publish-tooling trio: preinstall guard + prepack + npm-pack guard
all touched the same script surface and shipped together).
Anything that could be reverted independently → separate PR.
Adjacent cleanups noticed during a fix → file as a `polish` issue,
don't sneak in. The `polish` label exists for "real but not urgent"
work: fix when next touching the area, not preemptively.

### Verify before declaring done

For substantive changes (new packages, behavior shifts, packaging
work), exercise the change end-to-end before committing. Mocks
cover the logic; smoke tests prove the integration. Bug fixes
start with a reproducer; confirming the bug exists rules out
fixing the wrong thing. The pack-smoke CI job catches install
regressions; if your change touches packaging, run the smoke
locally too (`pnpm pack` + `npm install` in `/tmp`).

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
tests run against `packages/*/src` directly; no need to build before
testing.

Use `pnpm pack` (not `npm pack`) for any workspace package. `npm pack`
ships unrewritten `workspace:*` deps; the prepack guard rejects it
with a hint, but the failure is a context switch best avoided by
reaching for `pnpm pack` directly.

## Dev-only sub-packages (standalone; not in the workspace)

- `conformance/`: upstream JSON Schema Test Suite + OpenAPI case
  harness. `cd conformance && pnpm install` to bootstrap.
- `performance/`: compile / validate benchmarks against other JSON
  Schema validators. `cd performance && pnpm install` to bootstrap.

Both have their own `package.json` + `pnpm-workspace.yaml` (with empty
`packages:` list so pnpm treats them as isolated roots). Their
external dev-dependencies (benchmark runners, competing validators,
`tsx`) are NOT in the main workspace install. Neither is type-checked
in CI; they're tsx-run dev tooling, breakage shows up when you run them.

## Architecture, package by package

- **`@oav/core`**: the shared error-tree model plus the helpers every
  other package and most consumers need. `ValidationError` tree
  (children always an array), path segments as `(string | number)[]`,
  the canonical formatters (`formatText` / `formatSummary` / `toJsonObject`;
  legacy aliases `formatJson` / `formatFlat` / `summarize` are still exported
  but deprecated, removal in v2.0)
  and the named-format dispatch (`formatError`, `formatErrors`,
  `KNOWN_OUTPUT_FORMATS`), `httpStatusFor` / `allowHeaderFor` /
  `toProblemDetails` for HTTP framing, RFC 6901 `resolveJsonPointer`,
  shared OpenAPI / HTTP types, and `detectOpenAPIVersion`. Everything
  else depends on this; nothing here depends on the others.
- **`@oav/schema`**: the JSON Schema 2020-12 compiler. Walks a schema,
  dispatches each keyword via `KeywordDefinition.compile(ctx)`, assembles
  the generated JS source, and `eval`s it through `new Function(deps, src)`.
  Boolean schemas (`true`/`false`) are first-class. `$ref` uses an
  identity-keyed cache so self-recursive refs emit normal recursive calls.
  The public barrel holds what keyword authors need; codegen mechanics
  (`NAMES`, `pathJoinExpr`, `rawExpr`, `quoteString`, runtime helpers,
  `SchemaRegistry`, `SUBSCHEMA_*_POSITIONS`, `createKeywordContext`)
  live behind the `oav/schema/internals` subpath. Reach
  for them only when a plugin genuinely needs them (not covered by
  semver).
- **`@oav/formats`**: pure string validators; exported as a `Record<string,
(s: string) => boolean>` suitable for `compileSchema`'s `formats` option.
- **`@oav/spec`**: `DocumentReader` abstraction (file/http/memory/composite)
  plus `resolveSpec()` which inlines external `$ref`s and leaves circular
  ones as internal refs. `applyOverlays()` handles the extension system.
- **`@oav/router`**: a sorted-list route matcher. Routes are sorted once
  at construction (more-literal segments first); `match` is a linear scan,
  O(routes × segments). Cheap for typical OpenAPI spec sizes.
- **`@oav/validator`**: the HTTP orchestrator. `createValidator(spec,
options)` returns a `Validator` exposing `validateRequest(req)`,
  `validateResponse(req, res)`, and `getOperation({ method, path })`.
  Per-operation parameter / body / response schemas are pre-compiled
  on first access; the validator handles route matching, content-type
  negotiation, parameter deserialization (style + explode), and
  response-status matching. Subtrees from each sub-validator are
  prefixed with the HTTP location (`body`, `query`, `header`, ...) so
  error paths are unambiguous. Also exports the Fetch-API adapter
  (`httpRequestFromFetch`, `httpResponseFromFetch`,
  `readBodyFromFetch`) for Next.js / Hono / Bun / Deno consumers.
- **`@oav/cli`**: thin commander wrapper. No business logic beyond arg
  parsing, I/O, and exit codes.
- **`@oav/oav-express4`**, **`@oav/oav-express5`**, **`@oav/oav-fastify`**:
  framework adapters. Thin: depend on `@aahoughton/oav-core`
  (transitive) and declare the matching framework as a peer. Each
  exports `validateRequests` (the middleware/hook factory),
  `httpRequestFrom<Framework>` (the standalone extractor), and
  `renderProblemDetails` (the default error renderer). Option and
  type names (`ValidateRequestsOptions`, `ErrorHandler<Ctx>`) are
  identical across the family; per-framework `Context` types use
  framework-native field names (`ExpressContext { req, res, next }`,
  `FastifyContext { request, reply }`). The `oav-express5` / Fastify
  variants are async-native and don't need `try/catch`; `oav-express4`
  forwards thrown errors via `next(err)`. A future `validateResponses`
  slots in additively on each adapter.

## Dependency graph (strictly enforced; no cycles)

```
cli           → validator → router
                         → spec → core
                         → formats → core
                         → schema → core
                         → core
              → spec → core
              → core
oav-express4  → validator → ... (same as cli's chain)
              → core
              (peer: express ^4)
oav-express5  → same chain, peer: express ^5
oav-fastify   → same chain, peer: fastify ^5
```

## How to add a new keyword

1. Create `packages/schema/src/keywords/<area>.ts` exporting a
   `KeywordDefinition` with `keyword`, `vocabulary`, `compile(ctx)`.
   Flags on the definition itself drive compiler specialisation.
   Set them correctly or performance optimisations silently mis-fire:
   - `applicator: true`: keyword descends into subschemas (items,
     properties, allOf, not, …). Drives the inliner to use the
     function-call path for multi-keyword schemas containing this
     keyword. A missed flag costs correctness (inlined applicators can
     skip per-function evaluated-keys state) and speed (V8 can't
     monomorphise a huge inline body).
   - `annotation: true`: keyword is metadata only, emits no runtime
     code (`title`, `description`, `$id`, `$schema`, `$comment`, …).
     Lets the inliner count keyword density correctly and avoids
     spurious "unknown-keyword" diagnostics.
   - `evaluates: { properties?: true; items?: true }`: keyword
     contributes to evaluated-keys / evaluated-items tracking for
     `unevaluated*`.

   `ctx.predicate` is `true` when the user requested predicate mode
   (`compileSchema(..., { predicate: true })`). Most keywords don't
   need to read this; `ctx.emitError`, `ctx.leafErrorExpr`,
   `ctx.validateSubschema`, and `ctx.emitBudgetBreak` all do the
   right thing automatically. Branch on it only when your keyword
   reads a sub-validator's return value (composition keywords,
   `$ref`, `contains`, `discriminator`, `dependentSchemas`); see the
   "Predicate mode" section below.

   The context (`KeywordCompileContext`) offers:
   - `ctx.gen`: code emitter (see the `CodeEmitter` interface).
   - `ctx.data`, `ctx.path`, `ctx.errors`: JS expressions for the
     current data, path array, and error accumulator.
   - `ctx.schema`, `ctx.parentSchema`: the keyword's value and the
     surrounding schema object.
   - `ctx.emitError(kind, expr)` / `ctx.errorStatement(kind, expr)`:
     push an error expression (`"leaf"` = counts against `maxErrors`,
     `"lift"` = propagating an already-counted sub-validator result).
   - `ctx.leafErrorExpr(codeExpr, msgExpr, paramsExpr, extraSegments?)`:
     build a `deps.createLeafError(...)` call. Pass any per-error
     trailing path segment (e.g. a missing property name) via
     `extraSegments` so the runtime helper splices them; the helper
     also picks up any segments pending from an enclosing inlined
     `validateSubschema` call. `ctx.branchErrorExpr(...)` is the
     equivalent for branch errors.
   - `ctx.validateSubschema(schema, dataExpr, { segment? })`: the
     common "descend into a subschema" pattern (inlines when simple).
   - `ctx.compileSubschema(schema) -> fnName`: lower-level; use when
     a keyword needs the sub-validator's return value for its own
     logic (composition keywords do this).
   - `ctx.resolveRef(ref)`, `ctx.evaluatedPropertiesVar` /
     `ctx.evaluatedItemsVar`: for `$ref` and unevaluated-tracking.
   - `ctx.effectivePathExpr`: JS expression for the runtime path
     including any pending inline segments. Reach for this only when
     passing the path to something other than the error helpers
     (e.g. a user-supplied custom-keyword callback).
   - `ctx.emitBudgetBreak()` at the tail of hot loops.

2. Add it to the vocabulary's `keywords` array in `vocabulary.ts`.
3. Re-export from `keywords/index.ts` and top-level `src/index.ts`.
4. Add a `test/keyword-<name>.test.ts` that compiles a schema, validates
   good + bad data, and asserts on `code` / `path` / `params` /
   `children` structure; never on generated code strings.
5. Add an entry to `BuiltInErrorParams` in `packages/core/src/errors.ts`
   describing the new error `code` and the shape of its `params`
   object. The compiler can't check this (errors are emitted through
   generated JS source), but it's the documented contract consumers
   narrow against; drift here is a silent bug.

## How to add a new format

1. Add the validator to `packages/formats/src/<area>.ts`.
2. Export from `packages/formats/src/index.ts`.
3. Add it to the `builtInFormats` record.
4. Test with RFC-sourced valid + invalid examples.

## How to add a new output format

Output format dispatch lives in `@oav/core` (not the CLI) so library
consumers can render by format name too. Programmatic callers can also
pass a renderer function directly (`formatError(err, (e) => ...)`)
without forking the switch.

1. Add the name to `KNOWN_OUTPUT_FORMATS` in
   `packages/core/src/format-output.ts`. The `OutputFormat` type and
   the CLI's Commander `--format` validator are both derived from it.
2. Add the rendering function to `packages/core/src/format.ts` (or emit
   straight from the leaves).
3. Add a branch to `formatError()` in `packages/core/src/format-output.ts`.
4. Add a test in `packages/core/test/format-output.test.ts`.

## Error-collection modes

By default the compiler collects every error into a tree. For very
large payloads (e.g. a 10 MB JSON array where every element fails the
same way) that's wasted CPU and memory. `compileSchema(schema,
{ maxErrors: N })` (also exposed on `@oav/validator`'s
`createValidator`) caps the tree at N leaves and short-circuits the
hot loops once the budget is exhausted. `maxErrors: 1` is the classic
fast-fail mode; the returned `{ valid: false, error, truncated: true }`
tells consumers their report is partial. Codegen is specialised: when
`maxErrors` is left unset, the generated source is identical to before
(no budget checks, no `truncated` tracking); zero overhead for
callers who don't opt in.

`maxErrors` must be a positive integer (>= 1). `compileSchema` and
`createValidator` both throw on `0`, negative values, or non-integers;
predicate mode (below) is the explicit way to opt out of error
collection entirely.

The budget semantics show up at the keyword-authoring level through
the `kind` argument on `ctx.emitError` / `ctx.errorStatement`:

- `ctx.emitError("leaf", expr)`: a **fresh leaf error**; counts
  against the budget. Use when the keyword itself is constructing a
  `createLeafError(...)` expression.
- `ctx.emitError("lift", expr)`: a **lift**, propagating a
  sub-validator's already-counted error up the tree, or wrapping
  already-counted children in a `createBranchError`. Always
  unconditional.

Using the wrong kind silently miscounts errors against the budget.
The `kind` is a required argument; TypeScript enforces that a choice
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
incompatible; predicate already short-circuits on the first failure,
so there is nothing to count.

For **keyword authors**, most keywords get predicate mode for free
because `ctx.emitError("leaf" | "lift", expr)` collapses to `return
false;` when `ctx.predicate === true`; `ctx.withPathSegment`,
`ctx.validateSubschema`, and `ctx.emitBudgetBreak` are similarly
predicate-aware. You only need to branch on `ctx.predicate` when your
keyword reads a sub-validator's return value for its own control flow:
composition keywords (`allOf`, `anyOf`, `oneOf`, `not`,
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

Dispatch is a one-liner inside `createValidator`: `dialectFor(version)`.
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
in the 3.0 vocabulary stack; schemas that use them are treated as
having an unknown field, which 2020-12 allows in every dialect.

### Running tests per version

- **Schema-level tests** (`packages/schema/test/*`) are
  dialect-agnostic; they compile schemas with the default 2020-12
  vocab and assert on 2020-12 semantics. Dialect-specific keyword
  tests sit next to their keyword files where sensible.
- **HTTP-level conformance** lives in
  `conformance/openapi-cases/petstore-{30,31,32}/`, one petstore per
  version, each exercising the version's distinctive features (3.0:
  `nullable`, boolean `exclusiveMinimum`; 3.2: QUERY method).
- **Validator integration tests** in
  `packages/validator/test/versioning.test.ts` cover dispatch,
  dialect-specific keyword behaviour, and the `dialect` override.

## Known limitations

- `$dynamicRef` currently behaves like `$ref` with an anchor lookup; no
  runtime dynamic-scope traversal. Good enough for schemas that don't
  actually rewire the extension point at runtime.
- `unevaluated*` evaluated-key tracking is gated at compile time on
  a one-pass walk of the root schema and any registered external
  schemas. If nothing uses `unevaluatedProperties` / `unevaluatedItems`,
  the compiler suppresses the per-function `evalProps` / `evalItems`
  Sets and the merge loop that threads them up to the caller.
  See `CompileState.unevaluatedTracking` and `schemaUsesUnevaluated`
  in `packages/schema/src/compiler/compiler.ts`.
