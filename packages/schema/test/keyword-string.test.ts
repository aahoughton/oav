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

  it("format: only asserts when a format validator is registered", () => {
    const looksLikeEmail = compile({ format: "email" }, { formats: { email: (s) => /@/.test(s) } });
    expect(looksLikeEmail.validate("x@y").valid).toBe(true);
    expect(looksLikeEmail.validate("nope").valid).toBe(false);
    expect(looksLikeEmail.validate("nope").error?.code).toBe("format");

    const noValidator = compile({ format: "whatever" });
    expect(noValidator.validate("anything").valid).toBe(true);
  });
});
