import { describe, expect, it } from "vitest";
import { compileSchema } from "../src/compiler/compiler.js";
import type { Vocabulary } from "../src/keywords/types.js";

const emptyVocab: Vocabulary = { uri: "test://empty", keywords: [] };

describe("compileSchema", () => {
  it("accepts everything when the schema is `true`", () => {
    const v = compileSchema(true, { vocabularies: [emptyVocab] });
    expect(v.validate(1)).toEqual({ valid: true });
    expect(v.validate("x")).toEqual({ valid: true });
    expect(v.validate(null)).toEqual({ valid: true });
    expect(v.validate({})).toEqual({ valid: true });
  });

  it("rejects everything when the schema is `false`", () => {
    const v = compileSchema(false, { vocabularies: [emptyVocab] });
    const result = v.validate(1);
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe("false");
    expect(result.error?.children).toEqual([]);
    expect(v.validate("x").valid).toBe(false);
  });

  it("accepts everything when the schema is the empty object", () => {
    const v = compileSchema({}, { vocabularies: [emptyVocab] });
    expect(v.validate(1)).toEqual({ valid: true });
    expect(v.validate(null)).toEqual({ valid: true });
  });

  it("generates syntactically valid JavaScript", () => {
    const v = compileSchema({}, { vocabularies: [emptyVocab] });
    expect(() => new Function(v.source)).not.toThrow();
  });

  it("emits a function-per-schema name pattern in the source", () => {
    const v = compileSchema({}, { vocabularies: [emptyVocab] });
    expect(v.source).toMatch(/function validate_0\(data, path\)/);
    expect(v.source).toMatch(/function validate\(data\) \{/);
  });

  it("builds a path array at the root", () => {
    const result = compileSchema(false, { vocabularies: [emptyVocab] }).validate(1);
    expect(result.valid).toBe(false);
    expect(result.error?.path).toEqual([]);
  });
});
