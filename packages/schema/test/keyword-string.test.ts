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

  it("maxLength treats a single surrogate-pair code point as length 1", () => {
    // Regression for #12: str.length would return 2 for this.
    const v = compile({ maxLength: 1 });
    expect(v.validate("👨").valid).toBe(true);
    expect(v.validate("ab").valid).toBe(false);
  });

  it("maxLength rejects a large string without allocating a code-point array", () => {
    // Regression for #143. The legacy `[...s].length` implementation
    // materialised one string-per-code-point for the whole input before
    // the length check could refuse it (trivially OOM-able). Validate
    // the fix: a multi-megabyte string against a 10-char cap returns a
    // failure quickly and without crashing.
    const big = "a".repeat(5_000_000);
    const v = compile({ maxLength: 10 });
    const start = Date.now();
    const res = v.validate(big);
    const elapsed = Date.now() - start;
    expect(res.valid).toBe(false);
    // Generous ceiling: the for...of walk is O(N) in time but O(1) in
    // memory. 2 s is orders of magnitude above the expected runtime
    // (~50 ms on modern hardware) and still catches a regression to
    // the allocating implementation.
    expect(elapsed).toBeLessThan(2000);
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

  it("pattern falls back to no-flag when `u` rejects stray escapes", () => {
    // Real-world case: DigitalOcean's spec uses patterns like
    //   ^[a-zA-Z0-9_\-\:]+$
    // which fail under the `u` flag (stray \- / \:) but are accepted
    // in non-Unicode mode. Validators should not reject these specs.
    const v = compile({ pattern: "^[a-zA-Z0-9_\\-\\:]+$" });
    expect(v.validate("abc-123:xyz").valid).toBe(true);
    expect(v.validate("abc!").valid).toBe(false);
  });

  it("pattern keeps Unicode-only features when `u` does parse", () => {
    // \p{L} is only meaningful under the `u` flag; without it, the
    // regex would match literal 'p{L}'. Verifies we try `u` first.
    const v = compile({ pattern: "^\\p{L}+$" });
    expect(v.validate("héllo").valid).toBe(true);
    expect(v.validate("abc123").valid).toBe(false);
  });

  it("pattern with a malformed regex throws at compile time (fail-fast on bad spec)", () => {
    expect(() => compile({ pattern: "(" })).toThrow(/Invalid regular expression/);
  });

  it("format is annotation-only by default (spec default)", () => {
    // Without the format-assertion vocabulary opt-in, bad values pass.
    const v = compile({ format: "email" }, { formats: { email: (s) => /@/.test(s) } });
    expect(v.validate("not an email").valid).toBe(true);
  });

  it("format asserts when the openapi31 dialect is used", async () => {
    const schema = await import("../src/index.js");
    const v = schema.compileSchema(
      { format: "email" },
      { dialect: schema.openapi31Dialect, formats: { email: (s) => /@/.test(s) } },
    );
    expect(v.validate("x@y").valid).toBe(true);
    expect(v.validate("nope").valid).toBe(false);
    expect(v.validate("nope").error?.code).toBe("format");

    const noValidator = schema.compileSchema(
      { format: "whatever" },
      { dialect: schema.openapi31Dialect },
    );
    expect(noValidator.validate("anything").valid).toBe(true);
  });
});
