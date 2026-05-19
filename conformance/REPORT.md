# Conformance report

Generated against three upstream / hand-curated test corpora:

- **JSON Schema Test Suite** — the canonical draft-2020-12 cases at
  <https://github.com/json-schema-org/JSON-Schema-Test-Suite>,
  cloned into `conformance/JSON-Schema-Test-Suite/` by `pnpm setup`.
- **OpenAPI Overlay 1.0 Test Suite** — the envelope-schema fixtures
  at <https://github.com/OAI/Overlay-Specification>, cloned into
  `conformance/Overlay-Specification/` by `pnpm setup:overlay`.
- **OpenAPI cases** — hand-curated request/response scenarios under
  `conformance/openapi-cases/<group>/`, covering the petstore shape
  across 3.0, 3.1, and 3.2.

## Summary

| Source                              | Cases | Pass | Mismatch | Error | % pass |
| ----------------------------------- | ----- | ---- | -------- | ----- | ------ |
| JSON Schema Test Suite (required)   | 1290  | 1271 | 15       | 4     | 98.5%  |
| JSON Schema Test Suite (+ optional) | 1452  | 1429 | 19       | 4     | 98.4%  |
| OpenAPI Overlay 1.0 (envelope)      | 32    | 32   | 0        | 0     | 100%   |
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
our runner. Those tests target strict-format-assertion behavior; by
spec default and our default, format is annotation-only, so most tests
there would vacuously pass. Enabling format-assertion and running them
is a separate exercise: each format brings its own tail of RFC edge
cases that the suite tightens every few revisions.

## OpenAPI Overlay 1.0

The upstream Overlay test suite is purely
envelope-schema-validation: every fixture under `tests/v1.0/pass/`
must match the canonical overlay JSON Schema, every fixture under
`tests/v1.0/fail/` must not. We compile that schema through
`@oav/schema` and run it as our envelope check. Current state:
**32/32 envelope parity** (12 pass + 20 fail).

The runner also feeds every pass fixture through
`@oav/overlay-spec`'s `translateOverlay()` and classifies the result
as `ok` / `unrecognised-target` / `translator-error`. This is
informational — upstream does not assert semantic translation — but
it surfaces translator-coverage gaps next to the envelope numbers.

Current translator classification on pass fixtures (12 total):

| Bucket                | Count | Notes                                                                                                                                                            |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                  | 1     | `actions-targeted-overlay-example.yaml` (`$.info`, `$.paths['/...']`, `$.servers[*]`).                                                                           |
| `unrecognised-target` | 5     | wildcards (`$.paths.*.get.parameters`), JSONPath filters / array indexing the closed-form recogniser doesn't accept.                                             |
| `translator-error`    | 6     | "no-op" actions (target-only, no `update`/`remove`) and the `update + remove: true` ambiguity. Permitted by the envelope schema but our translator rejects them. |

The translator-error bucket is a translator design choice (we'd
rather reject ambiguous / no-op actions than silently no-op). The
`unrecognised-target` bucket is the documented closed-form
limitation of the JSONPath recogniser. Neither is a regression
against an established baseline. CI compares envelope-pass and
translator-ok counts against `overlay-results.json`; widening the
recogniser or relaxing the translator both move the baseline up
rather than introducing failures.

## Behavioral parity notes

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
pnpm setup:overlay              # clones Overlay-Specification   (gitignored)
cd ..
pnpm build                      # builds the CLI the OpenAPI runner shells out to

cd conformance
pnpm suite                      # required suite
pnpm suite:optional             # + optional (format-edge-cases etc.)
pnpm suite -- --filter=ref      # just ref.json / refRemote.json
pnpm overlay                    # OpenAPI Overlay 1.0 envelope + translator
pnpm openapi                    # CLI-driven OpenAPI scenarios
```

Detailed per-case output lands in `conformance/json-schema-results.json`,
`conformance/overlay-results.json`, and `conformance/openapi-results.json`.
`overlay-results.json` and `openapi-results.json` are committed
baselines that CI compares against with `--check-baseline`; the
`+optional` JSON Schema variant remains gitignored.
