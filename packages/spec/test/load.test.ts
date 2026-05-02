import { describe, expect, it } from "vitest";
import { createMemoryReader } from "../src/reader.js";
import { loadSpec } from "../src/load.js";
import type { SpecOverlay } from "../src/overlay.js";

function baseReader(): ReturnType<typeof createMemoryReader> {
  return createMemoryReader(
    new Map<string, unknown>([
      [
        "main.json",
        {
          openapi: "3.1.0",
          info: { title: "X", version: "1" },
          paths: {
            "/pets": {
              get: { responses: { "200": { description: "ok" } } },
            },
          },
        },
      ],
    ]),
  );
}

describe("loadSpec", () => {
  it("returns a resolved document when no overlays are given", async () => {
    const { document, sources } = await loadSpec({ reader: baseReader(), entry: "main.json" });
    expect(document.paths?.["/pets"]?.get?.responses?.["200"]).toEqual({ description: "ok" });
    expect(sources).toEqual(["main.json"]);
  });

  it("applies overlays in order after resolution", async () => {
    const overlays: SpecOverlay[] = [
      { addPaths: { "/health": { get: { responses: { "200": { description: "ok" } } } } } },
    ];
    const { document } = await loadSpec({
      reader: baseReader(),
      entry: "main.json",
      overlays,
    });
    expect(document.paths?.["/health"]?.get).toBeDefined();
    expect(document.paths?.["/pets"]?.get).toBeDefined();
  });

  it("ignores an empty overlays array", async () => {
    const { document } = await loadSpec({
      reader: baseReader(),
      entry: "main.json",
      overlays: [],
    });
    expect(Object.keys(document.paths ?? {})).toEqual(["/pets"]);
  });

  it("inlines external $refs first, then applies overlays to the resolved document", async () => {
    // Integration: confirms `loadSpec` runs `resolveSpec` before
    // `applyOverlays`, so an overlay extending `components.schemas.Pet`
    // sees the inlined definition from the sibling file. If overlays
    // ran first, `Pet` would still be the bare `$ref` and extendSchemas
    // would silently insert the extension verbatim instead of wrapping.
    const reader = createMemoryReader(
      new Map<string, unknown>([
        [
          "main.json",
          {
            openapi: "3.1.0",
            info: { title: "X", version: "1" },
            paths: {
              "/pets": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
                    },
                  },
                  responses: { "201": { description: "created" } },
                },
              },
            },
            components: {
              schemas: {
                Pet: { $ref: "schemas.json#/Pet" },
              },
            },
          },
        ],
        [
          "schemas.json",
          {
            Pet: { type: "object", properties: { name: { type: "string" } } },
          },
        ],
      ]),
    );

    const { document, sources } = await loadSpec({
      reader,
      entry: "main.json",
      overlays: [{ extendSchemas: { Pet: { required: ["name"] } } }],
    });

    expect(sources.sort()).toEqual(["main.json", "schemas.json"]);
    // External ref inlined into components.schemas.Pet, then wrapped in
    // allOf by extendSchemas; proves resolveSpec ran first.
    const pet = document.components?.schemas?.["Pet"];
    expect(pet).toMatchObject({ allOf: expect.any(Array) });
  });
});
