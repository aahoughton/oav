# @oav/spec

Multi-file OpenAPI 3.1 loader + resolver + overlay merger.

## Loading a spec

```ts
import { composeReaders, createFileReader, resolveSpec } from "@oav/spec";

const reader = composeReaders([createFileReader()]);
const { document, sources } = await resolveSpec({ reader, entry: "openapi.yaml" });
// `document` has every external $ref inlined; `sources` lists every file that was loaded
```

Readers implement `DocumentReader`:

```ts
interface DocumentReader {
  canRead(uri: string): boolean;
  read(uri: string): Promise<unknown>;
}
```

Built-ins: `createFileReader`, `createHttpReader`, `createMemoryReader` (for
tests), and `composeReaders([...])` to layer them.

## Overlays

```ts
import { applyOverlays, type SpecOverlay } from "@oav/spec";

const overlay: SpecOverlay = {
  addPaths: { "/v2/pets": { get: { responses: { "200": { description: "ok" } } } } },
  overrides: {
    "/pets": {
      operations: {
        get: { addParameters: [{ name: "X-Tenant", in: "header", schema: { type: "string" } }] },
      },
    },
    "*": {
      // wildcard applies to every path
      operations: {
        post: { addParameters: [{ name: "trace", in: "header", schema: { type: "string" } }] },
      },
    },
  },
  extendSchemas: { Pet: { required: ["name"] } },
  replaceSchemas: { LegacyPet: { type: "null" } },
};

const patched = applyOverlays(document, [overlay]);
```

Overlays apply in order; later overlays win on conflict. `addPaths` errors
on duplicates; `extendSchemas` wraps in `allOf`; `replaceSchemas` does a
full swap.
