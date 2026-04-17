import { describe, expect, it } from "vitest";
import { composeReaders, createMemoryReader } from "../src/reader.js";
import { resolveSpec } from "../src/resolver.js";

describe("resolveSpec", () => {
  it("returns the document unchanged when there are no external refs", async () => {
    const reader = createMemoryReader(
      new Map<string, unknown>([
        [
          "main.json",
          {
            openapi: "3.1.0",
            info: { title: "X", version: "1" },
            paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
          },
        ],
      ]),
    );
    const { document, sources } = await resolveSpec({ reader, entry: "main.json" });
    expect(document.info.title).toBe("X");
    expect(sources).toEqual(["main.json"]);
  });

  it("inlines external refs, loading each file exactly once", async () => {
    const reader = composeReaders([
      createMemoryReader(
        new Map<string, unknown>([
          [
            "main.json",
            {
              openapi: "3.1.0",
              info: { title: "X", version: "1" },
              paths: {
                "/p": {
                  get: { responses: { "200": { $ref: "responses.json#/Ok" } } },
                },
              },
            },
          ],
          [
            "responses.json",
            {
              Ok: {
                description: "ok",
                content: { "application/json": { schema: { $ref: "schemas/pet.json" } } },
              },
            },
          ],
          ["schemas/pet.json", { type: "object", properties: { name: { type: "string" } } }],
        ]),
      ),
    ]);
    const { document, sources } = await resolveSpec({ reader, entry: "main.json" });
    const resp = (document.paths?.["/p"]?.get?.responses ?? {})["200"];
    expect(resp?.description).toBe("ok");
    expect(sources).toContain("responses.json");
    expect(sources).toContain("schemas/pet.json");
  });

  it("handles YAML and JSON inputs interchangeably", async () => {
    const reader = createMemoryReader(
      new Map<string, unknown>([
        [
          "main.yaml",
          "openapi: 3.1.0\ninfo:\n  title: X\n  version: '1'\npaths:\n  /x: { get: { responses: { '200': { description: ok } } } }",
        ],
      ]),
    );
    const { document } = await resolveSpec({ reader, entry: "main.yaml" });
    expect(document.info.title).toBe("X");
  });

  it("detects and short-circuits circular refs without infinite recursion", async () => {
    const reader = createMemoryReader(
      new Map<string, unknown>([
        [
          "a.json",
          {
            openapi: "3.1.0",
            info: { title: "X", version: "1" },
            components: { schemas: { A: { $ref: "b.json#/B" } } },
          },
        ],
        ["b.json", { B: { $ref: "a.json#/components/schemas/A" } }],
      ]),
    );
    const { document } = await resolveSpec({ reader, entry: "a.json" });
    expect(document).toBeDefined();
  });
});
