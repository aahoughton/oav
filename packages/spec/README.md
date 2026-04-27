# oav/spec

Multi-file OpenAPI loader, `$ref` resolver, and overlay merger. Use
this when you want to stitch a spec together before handing it to
`createValidator`.

This module is available at matching subpaths in both
`oav/spec` and `oav-core/spec`. The examples
below import from `@aahoughton/oav`; substitute `@aahoughton/oav-core`
if you're on the lean package.

> **`oav-core` ships JSON readers only.** Calling
> `createFileReader()` or `createHttpReader()` on a `.yaml` / `.yml`
> path throws an install-hint error. For YAML support, install
> `@aahoughton/oav` (for the bundled `createYamlFileReader`) or
> register your own YAML reader.

## Loading a spec

`loadSpec` is the recommended entrypoint. It reads the entry document,
resolves external `$ref`s, and applies any overlays — in the right
order — in a single call:

```ts
import { composeReaders, createFileReader, loadSpec } from "@aahoughton/oav/spec";

const reader = composeReaders([createFileReader()]);
const { document, sources } = await loadSpec({
  reader,
  entry: "openapi.yaml",
  overlays: [], // optional
});
```

`document` has every external `$ref` inlined; `sources` lists every
file that was loaded along the way.

For custom composition (e.g. validate between resolve and overlay, or
load overlays yourself), call the primitives directly:
`resolveSpec({ reader, entry })`, then `applyOverlays(document, [...])`.

## Readers

Readers implement `DocumentReader`:

```ts
interface DocumentReader {
  canRead(uri: string): boolean;
  read(uri: string): Promise<unknown>;
}
```

Built-ins (JSON only — YAML support lives in `oav`):

- `createFileReader(cwd?)` — filesystem JSON. `.yaml` / `.yml` paths
  throw an install-hint error; compose with `createYamlFileReader` from
  `oav` to cover YAML.
- `createHttpReader()` — HTTP / HTTPS JSON. Same YAML policy.
- `createMemoryReader(entries)` — in-memory JSON or pre-parsed objects.
- `composeReaders([...])` — layers readers, dispatching by `canRead`.

`oav` additionally exports `createYamlFileReader`,
`createSmartHttpReader`, and `parseYamlString` for YAML-backed specs.
`createSmartHttpReader` supersedes the JSON-only `createHttpReader`
when composed — it claims every `http(s)` URI and dispatches by
response `Content-Type` (falling back to URL extension), so JSON and
YAML endpoints work through the same reader:

```ts
import { composeReaders, createFileReader } from "@aahoughton/oav/spec";
import { createSmartHttpReader, createYamlFileReader } from "@aahoughton/oav";

const reader = composeReaders([
  createYamlFileReader(),
  createSmartHttpReader(),
  createFileReader(),
]);
```

Write a custom reader (S3, blob store, bundled assets) by implementing
the two methods; plug it in via `composeReaders`.

## Overlays

```ts
import { applyOverlays, type SpecOverlay } from "@aahoughton/oav/spec";

const overlay: SpecOverlay = {
  addPaths: {
    "/v2/pets": { get: { responses: { "200": { description: "ok" } } } },
  },
  overrides: {
    "/pets": {
      operations: {
        get: {
          upsertParameters: [{ name: "X-Tenant", in: "header", schema: { type: "string" } }],
        },
      },
    },
    "*": {
      // wildcard applies to every path
      operations: {
        post: {
          upsertParameters: [{ name: "trace", in: "header", schema: { type: "string" } }],
        },
      },
    },
  },
  extendSchemas: { Pet: { required: ["name"] } },
  replaceSchemas: { LegacyPet: { type: "null" } },
};

const patched = applyOverlays(document, [overlay]);
```

Overlays apply in order; later overlays win on conflict. `addPaths`
errors on duplicates. `extendSchemas` wraps in `allOf`.
`replaceSchemas` does a full swap.

## `$ref` semantics

`resolveSpec` inlines external `$ref`s — references to separate files
or HTTP URIs. Internal references (`#/components/...`) are left alone;
the validator and schema compiler follow them at runtime via a
ref-resolution cache keyed on schema identity, so self-recursive
schemas compile to normal recursive calls.

Circular external references are rewritten to internal anchors
during resolution, so the final document is always self-contained.
