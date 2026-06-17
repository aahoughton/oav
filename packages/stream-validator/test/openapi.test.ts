import { describe, expect, it } from "vitest";
import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import { compileSchema, jsonSchemaDialect, oas30Dialect } from "@oav/schema";
import { createStreamValidator, normalizeOas30, type SpineVerdict } from "../src/index.js";

const enc = new TextEncoder();

async function verdictOf(
  schema: SchemaOrBoolean,
  value: unknown,
  opts: Record<string, unknown> = {},
): Promise<SpineVerdict> {
  const validator = createStreamValidator(schema, {
    policy: "detach",
    maxErrors: Number.POSITIVE_INFINITY,
    ...opts,
  });
  validator.on("error", () => {});
  validator.resume();
  const result = validator.result;
  validator.end(Buffer.from(enc.encode(JSON.stringify(value))));
  return result;
}

function inMem(schema: SchemaOrBoolean, value: unknown, dialect = jsonSchemaDialect): boolean {
  return compileSchema(schema as never, { dialect, maxErrors: Number.POSITIVE_INFINITY }).validate(
    value,
  ).valid;
}

describe("normalizeOas30", () => {
  it("widens nullable into a type union", () => {
    expect(normalizeOas30({ type: "string", nullable: true })).toEqual({
      type: ["string", "null"],
    });
    expect(normalizeOas30({ type: "string", nullable: false })).toEqual({ type: "string" });
  });

  it("folds boolean exclusive bounds into the numeric form", () => {
    expect(normalizeOas30({ maximum: 10, exclusiveMaximum: true })).toEqual({
      exclusiveMaximum: 10,
    });
    expect(normalizeOas30({ maximum: 10, exclusiveMaximum: false })).toEqual({ maximum: 10 });
    expect(normalizeOas30({ minimum: 0, exclusiveMinimum: true })).toEqual({ exclusiveMinimum: 0 });
  });

  it("suppresses siblings of a $ref", () => {
    expect(normalizeOas30({ $ref: "#/definitions/S", type: "number", maxLength: 1 })).toEqual({
      $ref: "#/definitions/S",
    });
  });

  it("recurses into nested subschema positions", () => {
    const out = normalizeOas30({
      type: "object",
      properties: { a: { type: "integer", nullable: true } },
    }) as SchemaObject;
    expect(out.properties?.a).toEqual({ type: ["integer", "null"] });
  });
});

describe("OpenAPI 3.0 verdict parity with @oav/schema oas30Dialect", () => {
  const cases: Array<{ schema: SchemaObject; values: unknown[] }> = [
    { schema: { type: "string", nullable: true }, values: ["x", null, 1] },
    {
      schema: {
        type: "object",
        properties: { a: { type: "integer", nullable: true } },
        required: ["a"],
      },
      values: [{ a: 1 }, { a: null }, { a: "x" }, {}],
    },
    { schema: { type: "number", maximum: 10, exclusiveMaximum: true }, values: [9, 10, 11] },
    { schema: { type: "number", minimum: 0, exclusiveMinimum: false }, values: [0, -1, 5] },
    {
      // $ref with a (suppressed) sibling, target in definitions.
      schema: {
        type: "object",
        properties: { x: { $ref: "#/definitions/S", maxLength: 1 } },
        definitions: { S: { type: "string" } },
      },
      values: [{ x: "abc" }, { x: 5 }, {}],
    },
  ];
  for (const { schema, values } of cases) {
    for (const value of values) {
      it(`${JSON.stringify(schema)} vs ${JSON.stringify(value)}`, async () => {
        const streamed = (await verdictOf(schema, value, { openApiVersion: "3.0" })).valid;
        expect(streamed).toBe(inMem(schema, value, oas30Dialect));
      });
    }
  }
});

describe("S2: island delegation resolves refs into definitions", () => {
  // The `kind` property is a oneOf island whose branches $ref into
  // `definitions`; the delegate must carry that container (not just
  // `$defs`) for the refs to resolve.
  const schema: SchemaObject = {
    type: "object",
    properties: {
      kind: { oneOf: [{ $ref: "#/definitions/A" }, { $ref: "#/definitions/B" }] },
    },
    definitions: {
      A: { type: "object", required: ["a"], properties: { a: {} } },
      B: { type: "object", required: ["b"], properties: { b: {} } },
    },
  };
  for (const value of [
    { kind: { a: 1 } },
    { kind: { b: 2 } },
    { kind: { a: 1, b: 2 } },
    { kind: {} },
  ]) {
    it(`oneOf-of-refs vs ${JSON.stringify(value)} matches in-memory`, async () => {
      const streamed = (await verdictOf(schema, value)).valid;
      expect(streamed).toBe(inMem(schema, value));
    });
  }
});
