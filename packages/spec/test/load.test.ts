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
});
