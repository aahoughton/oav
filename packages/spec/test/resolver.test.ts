import { describe, expect, it } from "vitest";
import { composeReaders, createMemoryReader } from "../src/reader.js";
import { resolveJsonPointer, resolveSpec } from "../src/resolver.js";

function collectInternalRefs(value: unknown, out: string[] = []): string[] {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectInternalRefs(item, out);
    return out;
  }
  const obj = value as Record<string, unknown>;
  const ref = obj.$ref;
  if (typeof ref === "string" && ref.startsWith("#")) out.push(ref);
  for (const key of Object.keys(obj)) {
    if (key === "$ref") continue;
    collectInternalRefs(obj[key], out);
  }
  return out;
}

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
    const refs = collectInternalRefs(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/")).toBe(true);
      const target = resolveJsonPointer(document, ref.slice(1));
      expect(target).toBeDefined();
    }
  });

  it("stitches three-way cycles (a → b → c → a) under $defs.__ext__", async () => {
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
        ["b.json", { B: { $ref: "c.json#/C" } }],
        ["c.json", { C: { $ref: "a.json#/components/schemas/A" } }],
      ]),
    );
    const { document } = await resolveSpec({ reader, entry: "a.json" });
    const docRecord = document as unknown as Record<string, unknown>;
    const defs = docRecord.$defs as Record<string, unknown>;
    const ext = defs.__ext__ as Record<string, unknown>;
    expect(Object.keys(ext).length).toBeGreaterThan(0);
    for (const ref of collectInternalRefs(document)) {
      const target = resolveJsonPointer(document, ref.slice(1));
      expect(target).toBeDefined();
    }
  });

  it("only stitches circular externals — non-circular refs are inlined", async () => {
    const reader = createMemoryReader(
      new Map<string, unknown>([
        [
          "main.json",
          {
            openapi: "3.1.0",
            info: { title: "X", version: "1" },
            components: {
              schemas: {
                Plain: { $ref: "plain.json" },
                Loop: { $ref: "loop.json#/Node" },
              },
            },
          },
        ],
        ["plain.json", { type: "object", properties: { n: { type: "integer" } } }],
        [
          "loop.json",
          {
            Node: {
              type: "object",
              properties: { next: { $ref: "loop.json#/Node" } },
            },
          },
        ],
      ]),
    );
    const { document } = await resolveSpec({ reader, entry: "main.json" });
    const schemas = (
      (document as unknown as Record<string, unknown>).components as Record<string, unknown>
    ).schemas as Record<string, Record<string, unknown>>;
    expect(schemas.Plain.type).toBe("object");
    expect(schemas.Plain.$ref).toBeUndefined();
    const docRecord = document as unknown as Record<string, unknown>;
    const ext = ((docRecord.$defs ?? {}) as Record<string, unknown>).__ext__ as Record<
      string,
      unknown
    >;
    expect(ext).toBeDefined();
    expect(Object.keys(ext)).toContain("loop.json");
    expect(Object.keys(ext)).not.toContain("plain.json");
    for (const ref of collectInternalRefs(document)) {
      const target = resolveJsonPointer(document, ref.slice(1));
      expect(target).toBeDefined();
    }
  });

  it("merges $defs.__ext__ with pre-existing $defs on the entry doc", async () => {
    const reader = createMemoryReader(
      new Map<string, unknown>([
        [
          "a.json",
          {
            openapi: "3.1.0",
            info: { title: "X", version: "1" },
            $defs: { Existing: { type: "string" } },
            components: { schemas: { A: { $ref: "b.json#/B" } } },
          },
        ],
        ["b.json", { B: { $ref: "a.json#/components/schemas/A" } }],
      ]),
    );
    const { document } = await resolveSpec({ reader, entry: "a.json" });
    const defs = (document as unknown as Record<string, unknown>).$defs as Record<string, unknown>;
    expect((defs.Existing as Record<string, unknown>).type).toBe("string");
    expect(defs.__ext__).toBeDefined();
  });
});
