# Conformance report

Generated against the upstream test suites listed in
`memory/oav_conformance_sources.md`.

## Summary

| Source                            | Cases | Pass | Mismatch | Error | % pass |
| --------------------------------- | ----- | ---- | -------- | ----- | ------ |
| JSON Schema Test Suite (required) | 1290  | 1158 | 64       | 68    | 89.8%  |
| OpenAPI `petstore` via `oav` CLI  | 14    | 14   | 0        | 0     | 100%   |

"Mismatch" = our verdict differs from upstream; "error" = our compiler
crashed (we couldn't produce a verdict at all).

The OpenAPI cases live in `conformance/openapi-cases/<group>/spec.yaml` +
`cases.json` and run through the real `oav` CLI binary. `expectCodes` on
each case lists the leaf error `code`s that must appear in our error tree
(full parity on messages isn't required — `oav` uses its own message
strings — but the machine-readable `code`s are stable and checkable).

## Where we diverge from the JSON Schema suite

Every remaining divergence falls into one of four categories, documented
below. The first two are intentional scope decisions; the last two are
known weak spots that we could harden without redesigning anything.

### 1. External / cross-document `$ref` (53 cases) — out of scope for the embedded compiler

`refRemote.json` (31 errors) and portions of `ref.json`, `anchor.json`,
`defs.json`, `vocabulary.json` expect the validator to fetch schemas from
`http://localhost:1234/…`, `https://json-schema.org/draft/2020-12/schema`,
URN refs, and relative URIs resolved through a `$id` stack. `@oav/schema`
resolves `#`-fragments within the schema passed in; cross-document loading
is the `@oav/spec` resolver's job (and `@oav/spec` already inlines external
refs _before_ compilation). The suite's tests run the compiler bare, so
they trigger this error.

**Fix path**: accept a pre-registered external schema map on `compileSchema`,
and teach the ref resolver to walk a base-URI stack built from `$id`.
Straightforward but deferred.

### 2. `unevaluatedProperties` / `unevaluatedItems` across composition (52 cases) — documented limitation

Our compiler tracks evaluated keys inside one generated function. When
`allOf` / `oneOf` / `anyOf` delegates to another compiled function, the
evaluation set doesn't propagate back. The suite tests this scenario
heavily. Documented in `CLAUDE.md` "Known limitations".

**Fix path**: make subschema validators return `{ error, evaluated }`
tuples (items + properties), and have every applicator merge those into
the enclosing scope. Requires touching every applicator keyword plus the
function-call convention; meaningful refactor but well-scoped.

### 3. `$dynamicRef` with runtime dynamic scope (24 cases) — partial implementation

Our `$dynamicRef` resolves statically against the anchor map. Tests that
rely on a `$dynamicRef` rebinding at the outermost `$dynamicAnchor`
encountered during validation fail. Documented in `CLAUDE.md`.

**Fix path**: maintain a runtime stack of `$dynamicAnchor` scopes during
validation, resolve `$dynamicRef` at call time.

### 4. Fixed so far

- `format.json` — 17 → 0. Flipped `format` to the spec's non-assertive
  default and put the assertion keyword behind an opt-in vocabulary that
  `@oav/validator` enables. Commit `e182afb`.
- JSON Pointer percent-decoding — 6 → 0 on `ref.json`. Same commit.

### 5. Remaining "single-case" failures — actually facets of #1–#3

Two divergences looked like standalone bugs in an earlier pass; on
closer inspection each is a surface of one of the larger limitations
above, and can't be fixed without the underlying work.

- `not.json` / "annotations are still collected inside a 'not'" — the
  schema wraps `anyOf` + `unevaluatedProperties: false` inside a `not`.
  Correct handling requires propagating the annotation set out of the
  `not`-subschema's compiled function. Same fix as #2
  (`unevaluatedProperties` across composition).
- `ref.json` / "order of evaluation: $id and $anchor and $ref" — two
  subschemas declare `$anchor: "bigint"`in different`$id` scopes. Our
  resolver flattens all anchors into one map keyed only by name, so the
  inner entry clobbers the outer one. Correct handling requires scoping
  anchors by their enclosing `$id` URI — that's the same base-URI stack
  #1 needs.

## Behavioural parity notes

Where we agree with upstream on pass/fail, we don't try to match their
error-message text — our error `code`s, `path`s, and `params` are the
parity surface. For the petstore OpenAPI cases the leaf codes are:

- `request` / `response` (root wrapper)
- `route` (no matching path)
- `body`, `path-param`, `query-param`, `header-param`, `cookie-param`
- `content-type` (media-type mismatch)
- `status` (undeclared response status)
- every JSON Schema keyword code — `type`, `minimum`, `required`, ...

Any consumer can drive alerting off these `code` values without parsing
message text.

## Reproduce

`conformance/` is a standalone package (its deps aren't in the main
workspace install). Bootstrap it once, then run the harness:

```bash
cd conformance
pnpm install
pnpm setup                      # clones JSON-Schema-Test-Suite (gitignored)
cd ..
pnpm build                      # builds the CLI the OpenAPI runner shells out to

cd conformance
pnpm suite                      # required suite
pnpm suite:optional             # + optional (format-edge-cases etc.)
pnpm suite -- --filter=ref      # just ref.json / refRemote.json
pnpm openapi                    # CLI-driven OpenAPI scenarios
```

Detailed per-case output lands in `conformance/json-schema-results.json`
and `conformance/openapi-results.json` (both gitignored).
