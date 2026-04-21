import { describe, expect, it, expectTypeOf } from "vitest";
import {
  collectLeaves,
  createBranchError,
  createError,
  createLeafError,
  joinPath,
  walkErrors,
  type ErrorParamsFor,
  type ValidationError,
} from "../src/errors.js";

describe("createError", () => {
  it("fills in empty children and params by default", () => {
    const err = createError({ code: "type", path: [], message: "x" });
    expect(err.children).toEqual([]);
    expect(err.params).toEqual({});
  });

  it("preserves provided children and params", () => {
    const child = createLeafError("required", ["body"], "missing");
    const err = createError({
      code: "body",
      path: [],
      message: "bad body",
      params: { matchCount: 0 },
      children: [child],
    });
    expect(err.children).toHaveLength(1);
    expect(err.children[0]).toBe(child);
    expect(err.params).toEqual({ matchCount: 0 });
  });
});

describe("createLeafError", () => {
  it("always produces an empty children array", () => {
    const err = createLeafError("type", ["a", 0], "must be string");
    expect(err.children).toEqual([]);
    expect(err.code).toBe("type");
    expect(err.path).toEqual(["a", 0]);
  });
  it("appends extraSegment to the path when provided", () => {
    const err = createLeafError("required", ["user"], "missing", { missing: "id" }, "id");
    expect(err.path).toEqual(["user", "id"]);
  });
  it("appends extraSegment + extraSegment2 when both are provided", () => {
    // Used by the subschema inliner when a caller's pending segment
    // stacks with the leaf keyword's own trailing segment.
    const err = createLeafError(
      "required",
      [],
      "missing",
      { missing: "id" },
      "user",
      "id",
    );
    expect(err.path).toEqual(["user", "id"]);
  });
});

describe("createBranchError", () => {
  it("carries the supplied children", () => {
    const leaves = [createLeafError("type", [], "x"), createLeafError("enum", [], "y")];
    const err = createBranchError("oneOf", [], "must match one", leaves, { matchCount: 0 });
    expect(err.children).toBe(leaves);
    expect(err.params).toEqual({ matchCount: 0 });
  });
  it("appends extraSegment + extraSegment2 when both are provided", () => {
    const children = [createLeafError("type", ["a", "b"], "x")];
    const err = createBranchError("schema", [], "wrap", children, {}, "a", "b");
    expect(err.path).toEqual(["a", "b"]);
  });
});

describe("walkErrors", () => {
  it("visits every node in pre-order with depth tracking", () => {
    const tree: ValidationError = createBranchError("body", [], "bad body", [
      createBranchError("oneOf", ["body"], "no match", [
        createLeafError("type", ["body", 0], "wrong type"),
        createLeafError("required", ["body", 1], "missing x"),
      ]),
    ]);
    const visited: Array<[string, number]> = [];
    walkErrors(tree, (node, depth) => {
      visited.push([node.code, depth]);
    });
    expect(visited).toEqual([
      ["body", 0],
      ["oneOf", 1],
      ["type", 2],
      ["required", 2],
    ]);
  });

  it("handles very deep trees (20 levels)", () => {
    let node = createLeafError("leaf", [], "leaf");
    for (let i = 0; i < 20; i += 1) {
      node = createBranchError(`level-${i}`, [], "branch", [node]);
    }
    let maxDepth = 0;
    walkErrors(node, (_n, d) => {
      if (d > maxDepth) maxDepth = d;
    });
    expect(maxDepth).toBe(20);
  });
});

describe("collectLeaves", () => {
  it("returns only nodes whose children array is empty", () => {
    const tree = createBranchError("root", [], "r", [
      createBranchError("oneOf", [], "o", [
        createLeafError("type", ["a"], "t1"),
        createLeafError("type", ["b"], "t2"),
      ]),
      createLeafError("required", [], "r1"),
    ]);
    const leaves = collectLeaves(tree).map((l) => l.code);
    expect(leaves).toEqual(["type", "type", "required"]);
  });

  it("returns the root itself when the tree is a single leaf", () => {
    const leaf = createLeafError("type", [], "x");
    expect(collectLeaves(leaf)).toEqual([leaf]);
  });
});

describe("BuiltInErrorParams", () => {
  it("narrows known params shapes via ErrorParamsFor", () => {
    expectTypeOf<ErrorParamsFor<"type">>().toEqualTypeOf<{
      expected: string[];
      actual: string;
    }>();
    expectTypeOf<ErrorParamsFor<"required">>().toEqualTypeOf<{ missing: string }>();
    expectTypeOf<ErrorParamsFor<"allOf">>().toEqualTypeOf<{ total: number; failed: number }>();
  });

  it("demonstrates the read-side narrowing pattern", () => {
    const err: ValidationError = createLeafError("required", ["body"], "missing", {
      missing: "name",
    });
    if (err.code === "required") {
      const p = err.params as ErrorParamsFor<"required">;
      expect(p.missing).toBe("name");
    }
  });
});

describe("joinPath", () => {
  it("renders strings dotted and numbers bracketed", () => {
    expect(joinPath(["body", "users", 3, "email"])).toBe("body.users[3].email");
  });

  it("produces '' for an empty path", () => {
    expect(joinPath([])).toBe("");
  });

  it("treats a leading number as a bracket", () => {
    expect(joinPath([0, "x"])).toBe("[0].x");
  });
});
