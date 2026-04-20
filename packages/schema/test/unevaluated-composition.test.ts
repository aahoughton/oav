import { describe, expect, it } from "vitest";
import type { ValidationError } from "@oav/core";
import { compile } from "./helpers.js";

function leafCodes(err: ValidationError | undefined): string[] {
  if (err === undefined) return [];
  if (err.children === undefined || err.children.length === 0) return [err.code];
  return err.children.flatMap((c) => leafCodes(c));
}

describe("unevaluatedProperties across composition", () => {
  it("counts properties from an allOf branch as evaluated", () => {
    const v = compile({
      type: "object",
      allOf: [{ properties: { foo: { type: "string" } } }],
      unevaluatedProperties: false,
    });
    expect(v.validate({ foo: "ok" }).valid).toBe(true);
    const r = v.validate({ foo: "ok", bar: 1 });
    expect(r.valid).toBe(false);
    expect(leafCodes(r.error)).toContain("unevaluatedProperties");
  });

  it("counts properties from a passing anyOf branch as evaluated", () => {
    const v = compile({
      type: "object",
      anyOf: [
        { properties: { foo: { type: "string" } }, required: ["foo"] },
        { properties: { baz: { type: "integer" } }, required: ["baz"] },
      ],
      unevaluatedProperties: false,
    });
    expect(v.validate({ foo: "ok" }).valid).toBe(true);
    expect(v.validate({ baz: 1 }).valid).toBe(true);
    expect(v.validate({ foo: "ok", bar: 1 }).valid).toBe(false);
  });

  it("counts properties from the winning oneOf branch as evaluated", () => {
    const v = compile({
      type: "object",
      oneOf: [
        { properties: { foo: { type: "string" } }, required: ["foo"] },
        { properties: { baz: { type: "integer" } }, required: ["baz"] },
      ],
      unevaluatedProperties: false,
    });
    expect(v.validate({ foo: "ok" }).valid).toBe(true);
    expect(v.validate({ foo: "ok", bar: 1 }).valid).toBe(false);
  });

  it("counts properties declared behind a $ref as evaluated", () => {
    const v = compile({
      $defs: {
        Named: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
      type: "object",
      $ref: "#/$defs/Named",
      unevaluatedProperties: false,
    });
    expect(v.validate({ name: "ok" }).valid).toBe(true);
    expect(v.validate({ name: "ok", extra: true }).valid).toBe(false);
  });

  it("propagates across two-deep nested allOf", () => {
    const v = compile({
      type: "object",
      allOf: [
        {
          allOf: [{ properties: { foo: { type: "string" } } }],
        },
      ],
      unevaluatedProperties: false,
    });
    expect(v.validate({ foo: "ok" }).valid).toBe(true);
    expect(v.validate({ foo: "ok", bar: 1 }).valid).toBe(false);
  });

  it("counts items from an allOf branch as evaluated", () => {
    const v = compile({
      type: "array",
      allOf: [{ prefixItems: [{ type: "string" }, { type: "integer" }] }],
      unevaluatedItems: false,
    });
    expect(v.validate(["a", 1]).valid).toBe(true);
    expect(v.validate(["a", 1, true]).valid).toBe(false);
  });
});
