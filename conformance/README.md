# @oav-dev/conformance

Conformance harness for `oav`. Runs the canonical
[JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
against `@oav/schema` and a set of OpenAPI request/response scenarios
against the built `oav` CLI. Reports verdict parity and flags any
mismatches.

This is a **standalone package** inside the monorepo. Its deps aren't
pulled by the main `pnpm install` — bootstrap it on its own:

```bash
cd conformance
pnpm install
pnpm setup        # clones JSON-Schema-Test-Suite (gitignored; ~12k cases)
cd ..
pnpm build        # the OpenAPI runner shells out to dist/cli.js
```

## Commands

```bash
cd conformance
pnpm suite                          # JSON Schema Test Suite (required only)
pnpm suite:optional                 # + optional/ suite (format edge cases, etc.)
pnpm suite -- --filter=ref          # just files matching "ref"
pnpm openapi                        # CLI-driven OpenAPI scenarios
```

Output: per-file table on stdout, raw JSON written to
`json-schema-results.json` / `openapi-results.json` (both gitignored).

## Where to add new cases

- **Schema-level**: upstream — the harness reads
  `JSON-Schema-Test-Suite/tests/draft2020-12/*.json` as-is. Add schemas
  there only if you're upstreaming; prefer to express schema corners in
  `packages/schema/test/`.
- **HTTP-level**: create `openapi-cases/<group>/spec.yaml` plus
  `cases.json`. Each case is
  `{name, kind: "request"|"response", method, path, ..., expect: "valid"|"invalid", expectCodes?: string[]}`.
  The runner spawns the CLI, diffs exit code + leaf error `code`s.

## Latest results

See [`REPORT.md`](./REPORT.md) for a current analysis — what passes, what
fails, and whether each divergence is design, documented limitation, or
a bug worth fixing.
