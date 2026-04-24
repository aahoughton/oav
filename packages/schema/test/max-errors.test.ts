import { describe, expect, it } from "vitest";
import { collectLeaves } from "@oav/core";
import { compileSchema } from "../src/compiler/compiler.js";
import { jsonSchemaDialect } from "../src/keywords/vocabulary.js";

function compile(schema: unknown, maxErrors?: number): ReturnType<typeof compileSchema> {
  return compileSchema(schema as never, { dialect: jsonSchemaDialect, maxErrors });
}

describe("maxErrors option", () => {
  it("is uncapped by default", () => {
    const v = compile({ required: ["a", "b", "c", "d"] });
    const r = v.validate({});
    expect(r.valid).toBe(false);
    expect(collectLeaves(r.error!)).toHaveLength(4);
    expect(r.truncated).toBeUndefined();
  });

  it("caps total leaf errors at the configured maxErrors", () => {
    const v = compile({ required: ["a", "b", "c", "d"] }, 2);
    const r = v.validate({});
    expect(r.valid).toBe(false);
    expect(collectLeaves(r.error!)).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  it("resets the budget between consecutive validate() calls", () => {
    const v = compile({ required: ["a", "b"] }, 1);
    const r1 = v.validate({});
    expect(collectLeaves(r1.error!)).toHaveLength(1);
    expect(r1.truncated).toBe(true);
    const r2 = v.validate({});
    expect(collectLeaves(r2.error!)).toHaveLength(1);
    expect(r2.truncated).toBe(true);
    // sanity: validity is unaffected
    const r3 = v.validate({ a: 1, b: 2 });
    expect(r3.valid).toBe(true);
  });

  it("maxErrors: 1 is the fast-fail mode", () => {
    const v = compile(
      {
        type: "object",
        required: ["a", "b", "c"],
        properties: {
          a: { type: "number" },
          b: { type: "number" },
          c: { type: "number" },
        },
      },
      1,
    );
    const r = v.validate({ a: "x", b: "y", c: "z" });
    expect(r.valid).toBe(false);
    expect(collectLeaves(r.error!)).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("short-circuits array-item iteration once the budget is exhausted", () => {
    // A large array where EVERY item fails. Without short-circuit we'd
    // walk all 10k items; with maxErrors=3 we should stop early.
    const v = compile({ type: "array", items: { type: "number" } }, 3);
    const badArray: unknown[] = [];
    for (let i = 0; i < 10_000; i += 1) badArray.push("string instead of number");
    const r = v.validate(badArray);
    expect(r.valid).toBe(false);
    // Leaf count proves the short-circuit: a non-gated impl would collect
    // 10_000 leaves, not 3.
    expect(collectLeaves(r.error!)).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it("short-circuits property iteration once the budget is exhausted", () => {
    const v = compile({ type: "object", additionalProperties: false }, 2);
    const bad: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i += 1) bad[`extra${i}`] = 1;
    const r = v.validate(bad);
    expect(r.valid).toBe(false);
    expect(collectLeaves(r.error!)).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  it("does not set truncated when everything fit in the budget", () => {
    const v = compile({ required: ["a"] }, 10);
    const r = v.validate({});
    expect(collectLeaves(r.error!)).toHaveLength(1);
    expect(r.truncated).toBeUndefined();
  });

  it("valid input never sets truncated even with a tight cap", () => {
    const v = compile({ type: "number" }, 1);
    expect(v.validate(42).valid).toBe(true);
    expect(v.validate(42).truncated).toBeUndefined();
  });

  it("rejects maxErrors: 0 at compile time", () => {
    // A cap of 0 collects no errors and would silently return
    // `valid: true` for invalid data — a correctness trap. Predicate
    // mode is the explicit way to skip error collection entirely.
    expect(() => compile({ type: "number" }, 0)).toThrow(
      /must be a positive integer.*Use `predicate: true`/,
    );
  });

  it("rejects negative and non-integer maxErrors", () => {
    expect(() => compile({ type: "number" }, -1)).toThrow(/must be a positive integer/);
    expect(() => compile({ type: "number" }, 1.5)).toThrow(/must be a positive integer/);
  });
});
