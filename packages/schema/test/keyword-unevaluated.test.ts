import { describe, expect, it } from "vitest";
import { compile } from "./helpers.js";

describe("unevaluatedProperties keyword", () => {
  it("rejects properties not covered by properties or patternProperties", () => {
    const v = compile({
      properties: { a: { type: "string" } },
      patternProperties: { "^x-": true },
      unevaluatedProperties: false,
    });
    expect(v.validate({ a: "x", "x-extra": 1 }).valid).toBe(true);
    const r = v.validate({ a: "x", unknown: 1 });
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe("unevaluatedProperties");
    expect(r.error?.path).toEqual(["unknown"]);
  });

  it("validates unevaluated properties against the given schema", () => {
    const v = compile({
      properties: { a: { type: "string" } },
      unevaluatedProperties: { type: "number" },
    });
    expect(v.validate({ a: "x", b: 1, c: 2 }).valid).toBe(true);
    expect(v.validate({ a: "x", b: "not a number" }).valid).toBe(false);
  });

  it("additionalProperties marks everything evaluated, making unevaluatedProperties a no-op", () => {
    const v = compile({
      properties: { a: { type: "string" } },
      additionalProperties: true,
      unevaluatedProperties: false,
    });
    expect(v.validate({ a: "x", extra: 1 }).valid).toBe(true);
  });
});

describe("unevaluatedItems keyword", () => {
  it("rejects items past the evaluated range when set to false", () => {
    const v = compile({
      prefixItems: [{ type: "string" }],
      unevaluatedItems: false,
    });
    expect(v.validate(["x"]).valid).toBe(true);
    expect(v.validate(["x", 1]).valid).toBe(false);
  });

  it("items: <schema> marks every element evaluated", () => {
    const v = compile({
      items: { type: "number" },
      unevaluatedItems: false,
    });
    expect(v.validate([1, 2, 3]).valid).toBe(true);
  });

  it("validates remaining items against the given schema", () => {
    const v = compile({
      prefixItems: [{ type: "string" }],
      unevaluatedItems: { type: "number" },
    });
    expect(v.validate(["x", 1, 2]).valid).toBe(true);
    expect(v.validate(["x", "not num"]).valid).toBe(false);
  });
});

describe("discriminator keyword", () => {
  it("validates only the branch selected by the discriminator property", () => {
    const v = compile({
      $defs: {
        Cat: {
          type: "object",
          required: ["purr"],
          properties: { kind: { const: "Cat" }, purr: { type: "boolean" } },
        },
        Dog: {
          type: "object",
          required: ["bark"],
          properties: { kind: { const: "Dog" }, bark: { type: "string" } },
        },
      },
      discriminator: { propertyName: "kind", mapping: { Cat: "#/$defs/Cat", Dog: "#/$defs/Dog" } },
      oneOf: [{ $ref: "#/$defs/Cat" }, { $ref: "#/$defs/Dog" }],
    });
    expect(v.validate({ kind: "Cat", purr: true }).valid).toBe(true);
    expect(v.validate({ kind: "Dog", bark: "woof" }).valid).toBe(true);

    const r = v.validate({ kind: "Cat" });
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe("required");
    expect(r.error?.path).toEqual(["purr"]);
  });

  it("errors when the discriminator value matches no branch", () => {
    const v = compile({
      $defs: {
        Cat: { type: "object", properties: { kind: { const: "Cat" } } },
      },
      discriminator: { propertyName: "kind", mapping: { Cat: "#/$defs/Cat" } },
      oneOf: [{ $ref: "#/$defs/Cat" }],
    });
    const r = v.validate({ kind: "Mouse" });
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe("discriminator");
    expect(r.error?.params).toMatchObject({ value: "Mouse" });
  });

  it("errors when the discriminator property is missing or non-string", () => {
    const v = compile({
      $defs: { Cat: { type: "object" } },
      discriminator: { propertyName: "kind", mapping: { Cat: "#/$defs/Cat" } },
      oneOf: [{ $ref: "#/$defs/Cat" }],
    });
    const r = v.validate({});
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe("discriminator");
  });
});
