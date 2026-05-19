# @oav-dev/conformance

Conformance harness for `oav`. Runs three upstream / hand-curated
corpora:

- The canonical
  [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
  against `@oav/schema`.
- The
  [OpenAPI Overlay 1.0 test suite](https://github.com/OAI/Overlay-Specification)
  against the envelope schema (compiled through `@oav/schema`) plus
  `@oav/overlay-spec`'s translator.
- A set of OpenAPI request/response scenarios against the built `oav`
  CLI.

Reports verdict parity and flags any mismatches.

This is a **standalone package** inside the monorepo. Its deps aren't
pulled by the main `pnpm install` — bootstrap it on its own:

```bash
cd conformance
pnpm install
pnpm setup            # clones JSON-Schema-Test-Suite (gitignored; ~12k cases)
pnpm setup:overlay    # clones Overlay-Specification (gitignored; ~32 fixtures)
cd ..
pnpm build            # the OpenAPI runner shells out to packages/oav/dist/cli.js
```

## Commands

```bash
cd conformance
pnpm suite                          # JSON Schema Test Suite (required only)
pnpm suite:optional                 # + optional/ suite (format edge cases, etc.)
pnpm suite -- --filter=ref          # just files matching "ref"
pnpm overlay                        # OpenAPI Overlay 1.0 envelope + translator
pnpm openapi                        # CLI-driven OpenAPI scenarios
```

Output: per-file table on stdout, raw JSON written to
`json-schema-results.json` / `overlay-results.json` / `openapi-results.json`
(`overlay-results.json` and `openapi-results.json` are committed
baselines that CI compares against with `--check-baseline`;
`json-schema-results.json` is committed but the `+optional` variant is
gitignored as a moving target).

## Where to add new cases

- **Schema-level**: upstream — the harness reads
  `JSON-Schema-Test-Suite/tests/draft2020-12/*.json` as-is. Add schemas
  there only if you're upstreaming; prefer to express schema corners in
  `packages/schema/test/`.
- **HTTP-level**: create `openapi-cases/<group>/spec.yaml` plus
  `cases.json`. Each case is
  `{name, kind: "request"|"response", method, path, ..., expect: "valid"|"invalid", expectCodes?: string[]}`.
  The runner spawns the CLI, diffs exit code + leaf error `code`s.
- **Overlay-level**: upstream — the harness reads
  `Overlay-Specification/tests/v1.0/{pass,fail}/*.yaml` as-is. Add
  fixtures there only if you're upstreaming. Translator coverage for
  specific JSONPath shapes belongs in
  `packages/overlay-spec/test/translate.test.ts`.

## Latest results

See [`REPORT.md`](./REPORT.md) for a current analysis — what passes, what
fails, and whether each divergence is design, documented limitation, or
a bug worth fixing.
