import { describe, expect, it } from "vitest";
import type { SchemaOrBoolean } from "@oav/core";
import { SpineUnsupportedError, SpineValidator } from "../src/spine/index.js";
import { JsonTokenizer } from "../src/tokenizer/index.js";

const enc = new TextEncoder();

function validate(schema: SchemaOrBoolean, json: string): { valid: boolean; codes: string[] } {
  const spine = new SpineValidator(schema);
  const tok = new JsonTokenizer(spine);
  tok.write(enc.encode(json));
  tok.end();
  const v = spine.verdict();
  return { valid: v.valid, codes: v.violations.map((x) => x.code) };
}

describe("SpineValidator violation paths", () => {
  it("reports the JSON path of a nested violation", () => {
    const schema: SchemaOrBoolean = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object", properties: { n: { type: "integer" } } } },
      },
    };
    const spine = new SpineValidator(schema);
    const tok = new JsonTokenizer(spine);
    tok.write(enc.encode('{"items":[{"n":1},{"n":"bad"}]}'));
    tok.end();
    const v = spine.verdict();
    expect(v.valid).toBe(false);
    expect(v.violations[0]?.path).toEqual(["items", 1, "n"]);
  });
});

describe("SpineValidator throws on constructs outside the STREAM set", () => {
  const unsupported: Array<[string, SchemaOrBoolean, string]> = [
    ["allOf", { allOf: [{ type: "string" }] }, '"x"'],
    ["anyOf", { anyOf: [{ type: "string" }] }, '"x"'],
    ["oneOf", { oneOf: [{ type: "string" }] }, '"x"'],
    ["not", { not: { type: "null" } }, '"x"'],
    ["contains", { type: "array", contains: { type: "string" } }, '["x"]'],
    ["object enum", { enum: [{ a: 1 }] }, '{"a":1}'],
    ["uniqueItems over objects", { type: "array", uniqueItems: true }, "[{}]"],
  ];
  for (const [name, schema, json] of unsupported) {
    it(`throws SpineUnsupportedError for ${name}`, () => {
      const spine = new SpineValidator(schema);
      const tok = new JsonTokenizer(spine);
      expect(() => {
        tok.write(enc.encode(json));
        tok.end();
      }).toThrow(SpineUnsupportedError);
    });
  }
});

describe("SpineValidator recursion is bounded by the heap, not the native stack", () => {
  it("validates a deeply nested value without a RangeError", () => {
    const schema: SchemaOrBoolean = {
      type: "object",
      properties: { next: { $ref: "#" } },
    };
    // ~20k deep: would blow a recursive-descent native stack, fine on the
    // heap scope stack.
    const depth = 20000;
    const json = `${'{"next":'.repeat(depth)}{}${"}".repeat(depth)}`;
    const result = validate(schema, json);
    expect(result.valid).toBe(true);
  });

  it("still finds a deep violation", () => {
    const schema: SchemaOrBoolean = {
      type: "object",
      properties: { next: { $ref: "#" }, leaf: { type: "integer" } },
    };
    const json = `{"next":{"next":{"leaf":"notint"}}}`;
    expect(validate(schema, json).valid).toBe(false);
  });
});
