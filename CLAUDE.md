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

## Known limitations

- `unevaluatedProperties` / `unevaluatedItems` do not propagate evaluation
  sets across `allOf` / `anyOf` / `oneOf` boundaries; each subschema
  compiles as its own function. See the TSDoc on
  `unevaluatedPropertiesKeyword` for detail.
- `$dynamicRef` currently behaves like `$ref` with an anchor lookup — no
  runtime dynamic-scope traversal. Good enough for schemas that don't
  actually rewire the extension point at runtime.
- `format` is assertive by default; unregistered formats pass.
