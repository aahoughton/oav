import { describe, expect, it } from "vitest";
import { compile } from "./helpers.js";

describe("string keywords", () => {
  it("maxLength / minLength count code points (emoji = 1)", () => {
    const max = compile({ maxLength: 3 });
    expect(max.validate("abc").valid).toBe(true);
    expect(max.validate("abcd").valid).toBe(false);
    expect(max.validate("🦀🦀🦀").valid).toBe(true);

    const min = compile({ minLength: 3 });
    expect(min.validate("abc").valid).toBe(true);
    expect(min.validate("ab").valid).toBe(false);
    expect(min.validate("🦀🦀").valid).toBe(false);
  });

  it("pattern matches against an ECMA-262 regex (unicode)", () => {
    const v = compile({ pattern: "^[a-z]+$" });
    expect(v.validate("abc").valid).toBe(true);
    expect(v.validate("abc1").valid).toBe(false);
    expect(v.validate("abc1").error?.code).toBe("pattern");
  });

  it("pattern leaves non-strings alone", () => {
    const v = compile({ pattern: "^x$" });
    expect(v.validate(1).valid).toBe(true);
  });

  it("format is annotation-only by default (spec default)", () => {
    // Without the format-assertion vocabulary opt-in, bad values pass.
    const v = compile({ format: "email" }, { formats: { email: (s) => /@/.test(s) } });
    expect(v.validate("not an email").valid).toBe(true);
  });

  it("format asserts when the format-assertion vocabulary is enabled", async () => {
    const schema = await import("../src/index.js");
    const vocabularies = [
      schema.coreVocabulary,
      schema.validationVocabulary,
      schema.applicatorVocabulary,
      schema.unevaluatedVocabulary,
      schema.formatAssertionVocabulary,
      schema.formatVocabulary,
    ];
    const v = schema.compileSchema(
      { format: "email" },
      { vocabularies, formats: { email: (s) => /@/.test(s) } },
    );
    expect(v.validate("x@y").valid).toBe(true);
    expect(v.validate("nope").valid).toBe(false);
    expect(v.validate("nope").error?.code).toBe("format");

    const noValidator = schema.compileSchema({ format: "whatever" }, { vocabularies });
    expect(noValidator.validate("anything").valid).toBe(true);
  });
});
