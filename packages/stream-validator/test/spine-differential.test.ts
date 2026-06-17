import { describe, expect, it } from "vitest";
import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import { compileSchema, jsonSchemaDialect } from "@oav/schema";
import { classify, ClassifierError } from "../src/classifier/index.js";
import { SpineUnsupportedError, SpineValidator } from "../src/spine/index.js";
import { JsonTokenizer } from "../src/tokenizer/index.js";

const enc = new TextEncoder();

/** Stream-validate `value` against `schema`, or signal "unsupported". */
function streamValid(schema: SchemaOrBoolean, value: unknown): boolean | "unsupported" {
  try {
    classify(schema); // fail-fast parity: a REJECT schema is unsupported
  } catch (err) {
    if (err instanceof ClassifierError) return "unsupported";
    throw err;
  }
  const spine = new SpineValidator(schema);
  const tok = new JsonTokenizer(spine);
  try {
    tok.write(enc.encode(JSON.stringify(value)));
    tok.end();
  } catch (err) {
    if (err instanceof SpineUnsupportedError) return "unsupported";
    throw err;
  }
  return spine.verdict().valid;
}

function inMemoryValid(schema: SchemaOrBoolean, value: unknown): boolean {
  return compileSchema(schema as never, {
    dialect: jsonSchemaDialect,
    maxErrors: Number.POSITIVE_INFINITY,
  }).validate(value).valid;
}

/**
 * The differential corpus: each schema paired with instances spanning
 * valid and invalid. The streaming verdict must equal the in-memory
 * verdict for every supported case; unsupported cases are skipped (they
 * fall to a later build step) but counted so a silent regression to
 * "everything skipped" is visible.
 */
const CORPUS: Array<{ schema: SchemaObject; values: unknown[] }> = [
  { schema: { type: "string" }, values: ["", "abc", 1, true, null, {}, []] },
  { schema: { type: "integer" }, values: [1, 1.0, 1.5, "1", true] },
  { schema: { type: "number" }, values: [1, 1.5, "x", null] },
  { schema: { type: ["string", "null"] }, values: ["x", null, 1, {}] },
  { schema: { type: "boolean" }, values: [true, false, 0, "true"] },
  {
    schema: { type: "string", minLength: 2, maxLength: 4 },
    values: ["a", "ab", "abcd", "abcde", "éé"],
  },
  { schema: { type: "string", pattern: "^a+$" }, values: ["aaa", "aab", "", "a"] },
  { schema: { enum: ["a", 1, null, true] }, values: ["a", 1, null, true, "b", 2, false] },
  { schema: { const: 42 }, values: [42, 43, "42"] },
  { schema: { type: "number", minimum: 0, maximum: 10 }, values: [0, 5, 10, -1, 11] },
  {
    schema: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 10 },
    values: [0, 0.0001, 10, 9.999],
  },
  { schema: { type: "integer", multipleOf: 3 }, values: [0, 3, 9, 4, -6] },
  { schema: { type: "number", multipleOf: 0.1 }, values: [0.3, 0.1, 0.2, 1, 0.15] },
  {
    schema: {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "integer" } },
      required: ["a"],
    },
    values: [{ a: "x" }, { a: "x", b: 1 }, { b: 1 }, { a: 1 }, { a: "x", b: "y" }, "not-object"],
  },
  {
    schema: { type: "object", additionalProperties: false, properties: { a: {} } },
    values: [{ a: 1 }, { a: 1, b: 2 }, {}],
  },
  {
    schema: { type: "object", additionalProperties: { type: "number" } },
    values: [{ a: 1 }, { a: "x" }, {}],
  },
  {
    schema: { type: "object", patternProperties: { "^x": { type: "number" } } },
    values: [{ x1: 1 }, { x1: "s" }, { y: "s" }],
  },
  {
    schema: { type: "object", propertyNames: { pattern: "^[a-z]+$" } },
    values: [{ ab: 1 }, { Ab: 1 }, { "1": 1 }],
  },
  {
    schema: { type: "object", minProperties: 1, maxProperties: 2 },
    values: [{}, { a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2, c: 3 }],
  },
  {
    schema: { type: "object", dependentRequired: { card: ["cvv"] } },
    values: [{}, { card: 1 }, { card: 1, cvv: 2 }, { cvv: 2 }],
  },
  {
    schema: {
      type: "object",
      properties: { p: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
    },
    values: [{ p: { q: "x" } }, { p: { q: 1 } }, { p: {} }, {}],
  },
  { schema: { type: "array", items: { type: "number" } }, values: [[], [1, 2], [1, "x"], "no"] },
  {
    schema: {
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      items: { type: "boolean" },
    },
    values: [["a", 1], ["a", 1, true], ["a", 1, 2], [1, 1], ["a"]],
  },
  { schema: { type: "array", minItems: 1, maxItems: 2 }, values: [[], [1], [1, 2], [1, 2, 3]] },
  {
    schema: { type: "array", uniqueItems: true },
    values: [[1, 2, 3], [1, 2, 2], [], ["a", "a"], [1, "1"]],
  },
  { schema: true, values: [1, "x", {}, [], null] },
  { schema: false, values: [1, "x", {}, null] },
  {
    schema: { type: "object", properties: { a: false } },
    values: [{}, { a: 1 }],
  },
  // Recursive $ref: a binary-tree-ish structure.
  {
    schema: {
      type: "object",
      properties: { value: { type: "integer" }, children: { type: "array", items: { $ref: "#" } } },
      required: ["value"],
    },
    values: [
      { value: 1 },
      { value: 1, children: [{ value: 2 }, { value: 3, children: [{ value: 4 }] }] },
      { value: 1, children: [{ value: "x" }] },
      { value: 1, children: [{ nope: true }] },
      { children: [] },
    ],
  },
  // $ref into $defs with a sibling constraint.
  {
    schema: {
      type: "object",
      properties: { id: { $ref: "#/$defs/Id" } },
      $defs: { Id: { type: "string", minLength: 3 } },
    },
    values: [{ id: "abc" }, { id: "ab" }, { id: 1 }, {}],
  },
];

describe("spine verdict equivalence with @oav/schema (differential)", () => {
  let supported = 0;
  let skipped = 0;
  for (const { schema, values } of CORPUS) {
    for (const value of values) {
      it(`${JSON.stringify(schema)} vs ${JSON.stringify(value)}`, () => {
        const streamed = streamValid(schema, value);
        if (streamed === "unsupported") {
          skipped += 1;
          return;
        }
        supported += 1;
        expect(streamed).toBe(inMemoryValid(schema, value));
      });
    }
  }
  it("exercised a meaningful number of supported cases", () => {
    // Guards against a regression that makes everything skip.
    expect(supported).toBeGreaterThan(60);
    void skipped;
  });
});
