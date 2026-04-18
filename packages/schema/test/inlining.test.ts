/**
 * Behavioural tests for the subschema-inlining optimisation. We don't
 * assert on the generated source directly — instead we compile schemas
 * that SHOULD be inlined, run them, and spot-check the generated
 * source for a telltale "was a named function called?" pattern so a
 * regression that accidentally stopped inlining would fail loudly.
 */

import { describe, expect, it } from "vitest";
import { compileSchema } from "../src/compiler/compiler.js";
import { defaultVocabularies } from "../src/keywords/vocabulary.js";

function compile(schema: unknown): ReturnType<typeof compileSchema> {
  return compileSchema(schema as never, { vocabularies: defaultVocabularies });
}

/** How many named validator helper functions does the generated source define? */
function namedFnCount(source: string): number {
  return (source.match(/\bfunction validate_\d+\b/g) ?? []).length;
}

describe("subschema inlining", () => {
  it("inlines a single-keyword items subschema (no extra function generated)", () => {
    const v = compile({ type: "array", items: { type: "number" } });
    // Only the root validator; items subschema lives inline.
    expect(namedFnCount(v.source)).toBe(1);
  });

  it("inlines a single-keyword properties subschema", () => {
    const v = compile({ type: "object", properties: { name: { type: "string" } } });
    expect(namedFnCount(v.source)).toBe(1);
  });

  it("inlines a multi-keyword subschema when it fits the budget", () => {
    const v = compile({
      type: "array",
      items: { type: "object", required: ["x"], properties: { x: { type: "number" } } },
    });
    // Only the root validator — items' object schema is inlined (no
    // $ref, few keywords, shallow).
    expect(namedFnCount(v.source)).toBe(1);
  });

  it("falls back to a named function when the subschema contains $ref", () => {
    const v = compile({
      $defs: {
        Pet: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      },
      type: "array",
      items: { $ref: "#/$defs/Pet" },
    });
    // The Pet schema is compiled to a function so recursion would
    // work if it referenced itself.
    expect(namedFnCount(v.source)).toBeGreaterThanOrEqual(2);
  });

  it("falls back to a named function past the inline-depth ceiling", () => {
    // 8 levels of nesting — exceeds MAX_INLINE_DEPTH=6.
    let inner: unknown = { type: "number" };
    for (let i = 0; i < 8; i += 1) {
      inner = { type: "object", properties: { nested: inner } };
    }
    const v = compile(inner);
    // At least one subschema had to be compiled as a function at some
    // depth.
    expect(namedFnCount(v.source)).toBeGreaterThanOrEqual(2);
  });

  it("inlining preserves validation behaviour — tree form", () => {
    const v = compile({ type: "array", items: { type: "number" } });
    expect(v.validate([1, 2, 3]).valid).toBe(true);
    const r = v.validate([1, "two", 3]);
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe("type");
    expect(r.error?.path).toEqual([1]);
  });

  it("inlining preserves validation behaviour — property form", () => {
    const v = compile({ type: "object", properties: { age: { type: "integer" } } });
    expect(v.validate({ age: 5 }).valid).toBe(true);
    const r = v.validate({ age: "x" });
    expect(r.valid).toBe(false);
    expect(r.error?.path).toEqual(["age"]);
  });

  it("inlining respects maxErrors — allocated paths still wear the budget cap", () => {
    const v = compileSchema(
      { type: "array", items: { type: "number" } },
      { vocabularies: defaultVocabularies, maxErrors: 3 },
    );
    const r = v.validate(["a", "b", "c", "d", "e"]);
    expect(r.valid).toBe(false);
    expect(r.truncated).toBe(true);
    // Collect leaves under the (possibly "schema"-wrapped) root
    const collect = (e: unknown, out: unknown[] = []): unknown[] => {
      if (e === null || typeof e !== "object") return out;
      const node = e as { children?: unknown[] };
      if (!Array.isArray(node.children) || node.children.length === 0) {
        out.push(e);
        return out;
      }
      for (const c of node.children) collect(c, out);
      return out;
    };
    expect(collect(r.error)).toHaveLength(3);
  });

  it("inlining does not break recursive $ref schemas (those stay as functions)", () => {
    const v = compile({
      $defs: {
        Node: {
          type: "object",
          properties: {
            value: { type: "number" },
            children: { type: "array", items: { $ref: "#/$defs/Node" } },
          },
        },
      },
      $ref: "#/$defs/Node",
    });
    // Node has to be a function for recursion. The inline-eligibles
    // (value, children outer) are single-keyword and inline.
    const tree = { value: 1, children: [{ value: 2, children: [{ value: 3 }] }] };
    expect(v.validate(tree).valid).toBe(true);
  });
});
