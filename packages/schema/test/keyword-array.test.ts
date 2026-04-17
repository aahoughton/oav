import { describe, expect, it } from "vitest";
import { compile } from "./helpers.js";

describe("array validation keywords", () => {
  it("maxItems / minItems enforce bounds", () => {
    const v = compile({ maxItems: 2, minItems: 1 });
    expect(v.validate([1]).valid).toBe(true);
    expect(v.validate([1, 2]).valid).toBe(true);
    expect(v.validate([1, 2, 3]).valid).toBe(false);
    expect(v.validate([1, 2, 3]).error?.code).toBe("maxItems");
    expect(v.validate([]).valid).toBe(false);
    expect(v.validate([]).error?.code).toBe("minItems");
  });

  it("uniqueItems rejects duplicates by deep equality", () => {
    const v = compile({ uniqueItems: true });
    expect(v.validate([1, 2, 3]).valid).toBe(true);
    expect(v.validate([{ a: 1 }, { a: 1 }]).valid).toBe(false);
    const r = v.validate([1, 2, 1]);
    expect(r.valid).toBe(false);
    expect(r.error?.code).toBe("uniqueItems");
    expect(r.error?.params).toMatchObject({ duplicates: [0, 2] });
  });

  it("uniqueItems: false is a no-op", () => {
    const v = compile({ uniqueItems: false });
    expect(v.validate([1, 1, 1]).valid).toBe(true);
  });

  it("leaves non-arrays alone", () => {
    const v = compile({ maxItems: 1, minItems: 1, uniqueItems: true });
    expect(v.validate({ length: 5 }).valid).toBe(true);
  });
});
