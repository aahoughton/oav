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

  it("emits exactly one named helper function for a trivial schema", () => {
    const v = compileSchema({}, { vocabularies: [emptyVocab] });
    expect(v.stats.functionCount).toBe(1);
  });

  it("builds a path array at the root", () => {
    const result = compileSchema(false, { vocabularies: [emptyVocab] }).validate(1);
    expect(result.valid).toBe(false);
    expect(result.error?.path).toEqual([]);
  });

  it("prepends startPath to every error path", () => {
    const v = compileSchema(false, { vocabularies: [emptyVocab] });
    const result = v.validate(1, ["body"]);
    expect(result.valid).toBe(false);
    expect(result.error?.path).toEqual(["body"]);
  });

  it("does not mutate the caller's startPath", () => {
    const v = compileSchema(false, { vocabularies: [emptyVocab] });
    const prefix: (string | number)[] = ["body"];
    v.validate(1, prefix);
    expect(prefix).toEqual(["body"]);
  });
});
