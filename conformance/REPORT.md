# Conformance report

Generated against two upstream test corpora:

- **JSON Schema Test Suite** — the canonical draft-2020-12 cases at
  <https://github.com/json-schema-org/JSON-Schema-Test-Suite>,
  cloned into `conformance/JSON-Schema-Test-Suite/` by `pnpm setup`.
- **OpenAPI cases** — hand-curated request/response scenarios under
  `conformance/openapi-cases/<group>/`, covering the petstore shape
  across 3.0, 3.1, and 3.2.

## Summary

| Source                              | Cases | Pass | Mismatch | Error | % pass |
| ----------------------------------- | ----- | ---- | -------- | ----- | ------ |
| JSON Schema Test Suite (required)   | 1290  | 1271 | 15       | 4     | 98.5%  |
| JSON Schema Test Suite (+ optional) | 1452  | 1429 | 19       | 4     | 98.4%  |
| OpenAPI `petstore` via `oav` CLI    | 14    | 14   | 0        | 0     | 100%   |

"Mismatch" = our verdict differs from upstream; "error" = our compiler
crashed (we couldn't produce a verdict at all).

The OpenAPI cases live in `conformance/openapi-cases/<group>/spec.yaml` +
`cases.json` and run through the real `oav` CLI binary. `expectCodes` on
each case lists the leaf error `code`s that must appear in our error
tree. Full parity on messages isn't required: `oav` uses its own
message strings, but the machine-readable `code`s are stable and
checkable.

## Where we diverge from the JSON Schema suite

Every remaining divergence falls into a small number of categories,
documented below.

### 1. `$dynamicRef` with runtime dynamic scope (~25 cases)

Partial implementation. Our `$dynamicRef` resolves statically against
the anchor map. Tests that rely on a `$dynamicRef` rebinding at the
outermost `$dynamicAnchor` encountered during validation fail.
Documented in `CLAUDE.md`.

**Fix path**: maintain a runtime stack of `$dynamicAnchor` scopes during
validation, resolve `$dynamicRef` at call time.

### 2. Fixed so far

- `format.json` (17 → 0). Flipped `format` to the spec's non-assertive
  default and put the assertion keyword behind an opt-in vocabulary that
  `@oav/validator` enables.
- JSON Pointer percent-decoding (6 → 0 on `ref.json`).
- `dependencies` (draft-07 compat): 14 → 0 on
  `optional/dependencies-compatibility.json`. The keyword was split in
  2020-12 into `dependentRequired` / `dependentSchemas`; older schemas
  continue to use the combined form, so we added a keyword that
  dispatches per-entry on value shape.
- External / cross-document `$ref`: `refRemote.json` 0/31 → 31/31.
  `compileSchema` now accepts a pre-registered external schema map
  via the `external` option, and `resolve()` walks every registered
  schema to collect its `$id` / `$anchor` entries scoped by base URI.
- `unevaluatedProperties` / `unevaluatedItems` across composition.
  Generated subvalidators now take out-parameter `Set<string>`s and
  composition / `$ref` / `if-then-else` / `dependentSchemas` keywords
  thread them through, merging keys from passing branches only.
- `if`-branch annotations & nested `unevaluated*: true`: fixed 14
  cases across `unevaluatedProperties.json` / `unevaluatedItems.json`.
  `if`'s evaluated-key set is now merged into the outer scope when
  `if` passes (2020-12 semantics, not 2019-09's drop-on-if), which
  also threads `contains`-via-`if` annotations into
  `unevaluatedItems`. A nested `unevaluatedProperties: true` /
  `unevaluatedItems: true` now marks every iterated key/index as
  evaluated so outer scopes see them.

## Optional-suite breakdown

Running with `--optional` widens to 1452 cases. The extra 162 cases
live under `tests/draft2020-12/optional/`. Current state:

| File                                                                                                 | Status                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `anchor.json`, `cross-draft.json`                                                                    | 3 errors, external-ref loading (same as category #1).                                                                 |
| `dependencies-compatibility.json`                                                                    | **14 → 0** (fixed in commit `79af5a7`).                                                                               |
| `dynamicRef.json`                                                                                    | 2 failures, subset of category #1.                                                                                    |
| `float-overflow.json`                                                                                | 1 failure: "optional overflow handling", explicitly flagged as implementation-optional in the test group description. |
| `format-assertion.json`                                                                              | 2 failures: requires meta-schema loading via `$schema`, tied to category #1.                                          |
| `bignum.json`, `ecmascript-regex.json`                                                               | pass.                                                                                                                 |
| `non-bmp-regex.json`, `id.json`, `no-schema.json`, `unknownKeyword.json`, `refOfUnknownKeyword.json` | pass.                                                                                                                 |

The per-format subtree (`optional/format/*.json`) isn't traversed by
our runner. Those tests target strict-format-assertion behaviour; by
spec default and our default, format is annotation-only, so most tests
there would vacuously pass. Enabling format-assertion and running them
is a separate exercise: each format brings its own tail of RFC edge
cases that the suite tightens every few revisions.

## Behavioural parity notes

Where we agree with upstream on pass/fail, we don't try to match their
error-message text. Our error `code`s, `path`s, and `params` are the
parity surface. For the petstore OpenAPI cases the leaf codes are:

- `request` / `response` (root wrapper)
- `route` (no matching path)
- `body`, `path-param`, `query-param`, `header-param`, `cookie-param`
- `content-type` (media-type mismatch)
- `status` (undeclared response status)
- every JSON Schema keyword code: `type`, `minimum`, `required`, ...

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
