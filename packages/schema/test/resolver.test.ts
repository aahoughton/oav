import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve/resolver.js";

describe("resolve", () => {
  it("returns the schema itself as the root", () => {
    const schema = { type: "number" };
    const graph = resolve(schema);
    expect(graph.root).toBe(schema);
  });

  it("accepts boolean root schemas", () => {
    expect(resolve(true).root).toBe(true);
    expect(resolve(false).root).toBe(false);
  });

  it("collects $id and $anchor entries from nested subschemas", () => {
    const pet = { $id: "/Pet", type: "object" } as const;
    const tail = { $anchor: "tail", type: "string" } as const;
    const schema = { $defs: { Pet: pet, Tail: tail } };
    const graph = resolve(schema);
    expect(graph.byId.get("/Pet")).toBe(pet);
    expect(graph.byAnchor.get("tail")).toBe(tail);
  });

  it("collects $dynamicAnchor entries", () => {
    const schema = { $dynamicAnchor: "node", type: "object" };
    const graph = resolve(schema);
    expect(graph.byDynamicAnchor.get("node")).toBe(schema);
  });

  it("descends into properties, items, prefixItems, allOf, oneOf, not", () => {
    const a = { $anchor: "a", type: "string" } as const;
    const b = { $anchor: "b", type: "number" } as const;
    const c = { $anchor: "c", type: "boolean" } as const;
    const d = { $anchor: "d", type: "array" } as const;
    const e = { $anchor: "e", type: "null" } as const;
    const schema = {
      properties: { a },
      items: b,
      prefixItems: [c],
      oneOf: [d],
      not: e,
    };
    const graph = resolve(schema);
    for (const name of ["a", "b", "c", "d", "e"]) {
      expect(graph.byAnchor.has(name)).toBe(true);
    }
  });
});
