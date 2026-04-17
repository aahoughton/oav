import { describe, expect, it } from "vitest";
import { compile } from "./helpers.js";

describe("numeric keywords", () => {
  it("multipleOf rejects non-multiples and passes non-numbers", () => {
    const v = compile({ multipleOf: 3 });
    expect(v.validate(9).valid).toBe(true);
    expect(v.validate(10).valid).toBe(false);
    expect(v.validate("nope").valid).toBe(true);
    const r = v.validate(10);
    expect(r.error?.code).toBe("multipleOf");
    expect(r.error?.params).toMatchObject({ multipleOf: 3, actual: 10 });
  });

  it("maximum / exclusiveMaximum enforce upper bounds", () => {
    const max = compile({ maximum: 10 });
    expect(max.validate(10).valid).toBe(true);
    expect(max.validate(11).valid).toBe(false);
    expect(max.validate(11).error?.code).toBe("maximum");

    const ex = compile({ exclusiveMaximum: 10 });
    expect(ex.validate(9).valid).toBe(true);
    expect(ex.validate(10).valid).toBe(false);
    expect(ex.validate(10).error?.code).toBe("exclusiveMaximum");
  });

  it("minimum / exclusiveMinimum enforce lower bounds", () => {
    const min = compile({ minimum: 0 });
    expect(min.validate(0).valid).toBe(true);
    expect(min.validate(-1).valid).toBe(false);
    expect(min.validate(-1).error?.code).toBe("minimum");

    const ex = compile({ exclusiveMinimum: 0 });
    expect(ex.validate(1).valid).toBe(true);
    expect(ex.validate(0).valid).toBe(false);
    expect(ex.validate(0).error?.code).toBe("exclusiveMinimum");
  });

  it("numeric bounds leave non-numbers alone", () => {
    const v = compile({ minimum: 0, maximum: 100 });
    expect(v.validate("x").valid).toBe(true);
    expect(v.validate(null).valid).toBe(true);
  });
});
