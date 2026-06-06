import { describe, expect, it } from "vitest";
import { deepEqual } from "../src/compiler/runtime.js";
import { compile } from "./helpers.js";

// Builds a left-nested structure `kind` deep: arrays as [x], objects as
// { next: x }, bottoming out at `leaf`. Iterative so the test setup
// itself can't overflow on the depths we exercise below.
function nest(depth: number, kind: "array" | "object", leaf: unknown): unknown {
  let node = leaf;
  for (let i = 0; i < depth; i += 1) {
    node = kind === "array" ? [node] : { next: node };
  }
  return node;
}

describe("deepEqual: structural equality", () => {
  it("treats identical primitives as equal", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("x", "x")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
  });

  it("treats distinct primitives of the same type as unequal", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(true, false)).toBe(false);
  });

  it("treats cross-type values as unequal", () => {
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({}, [])).toBe(false);
  });

  it("treats NaN as not equal to itself (JSON has no NaN)", () => {
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(false);
  });

  it("treats +0 and -0 as equal", () => {
    expect(deepEqual(0, -0)).toBe(true);
  });

  it("compares arrays element-wise and order-sensitively", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], [])).toBe(true);
  });

  it("compares objects by key set, ignoring key order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({}, {})).toBe(true);
  });

  it("rejects objects with the same key count but different keys", () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  it("rejects objects with differing key counts", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("does not confuse a missing key with an undefined-valued key", () => {
    // `{ a: undefined }` has key "a"; `{}` does not. Same intent as JSON,
    // where neither object would carry the key, but guards the hasOwnProperty
    // path regardless.
    expect(deepEqual({ a: undefined }, {})).toBe(false);
  });

  it("recurses through nested mixed structures", () => {
    const a = { id: 1, tags: ["x", "y"], meta: { nested: [{ k: 1 }] } };
    const b = { meta: { nested: [{ k: 1 }] }, tags: ["x", "y"], id: 1 };
    expect(deepEqual(a, b)).toBe(true);

    const c = { id: 1, tags: ["x", "y"], meta: { nested: [{ k: 2 }] } };
    expect(deepEqual(a, c)).toBe(false);
  });
});

describe("deepEqual: stack safety on deep input", () => {
  // A recursive implementation throws RangeError (~5k frames on a default
  // Node stack); the iterative one must handle far deeper input.
  const DEPTH = 100_000;

  it("compares deeply nested equal arrays without overflowing", () => {
    expect(deepEqual(nest(DEPTH, "array", 1), nest(DEPTH, "array", 1))).toBe(true);
  });

  it("compares deeply nested equal objects without overflowing", () => {
    expect(deepEqual(nest(DEPTH, "object", "leaf"), nest(DEPTH, "object", "leaf"))).toBe(true);
  });

  it("detects a difference at the bottom of a deep structure without overflowing", () => {
    expect(deepEqual(nest(DEPTH, "array", 1), nest(DEPTH, "array", 2))).toBe(false);
    expect(deepEqual(nest(DEPTH, "object", "a"), nest(DEPTH, "object", "b"))).toBe(false);
  });
});

describe("deepEqual: end-to-end through compiled keywords", () => {
  const DEPTH = 100_000;

  // `const` / `enum` compare data against a value embedded in the schema, so
  // they only drive deepEqual deep when the *schema* value is deep, and that
  // path overflows earlier in `JSON.stringify` at compile time (trusted,
  // deterministic schema-author input, out of scope for payload hardening).
  // `uniqueItems` is the keyword whose deep deepEqual operands come from the
  // untrusted payload, so it is the meaningful end-to-end guard here.
  it("evaluates `uniqueItems` over deeply nested object elements without overflowing", () => {
    const v = compile({ uniqueItems: true });
    const elem = (): unknown => nest(DEPTH, "object", "leaf");
    // Two structurally-equal deep objects: not unique, must fail.
    expect(v.validate([elem(), elem()]).valid).toBe(false);
    // Differ at the bottom: unique, must pass.
    expect(v.validate([nest(DEPTH, "object", "a"), nest(DEPTH, "object", "b")]).valid).toBe(true);
  });
});
