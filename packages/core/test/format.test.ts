import { describe, expect, it } from "vitest";
import { createBranchError, createLeafError, type ValidationError } from "../src/errors.js";
import { countErrors, formatSummary, formatText, toJsonObject } from "../src/format.js";

/** A realistic 4-level oneOf failure used by several formatter assertions. */
function sampleTree(): ValidationError {
  return createBranchError("body", ["body"], "request body invalid", [
    createBranchError(
      "oneOf",
      ["body"],
      "must match exactly one of 2 schemas",
      [
        createBranchError(
          "branch",
          ["body"],
          "branch 0 (Cat) failed",
          [createLeafError("type", ["body", "purr"], "must be boolean")],
          { index: 0, title: "Cat" },
        ),
        createBranchError(
          "branch",
          ["body"],
          "branch 1 (Dog) failed",
          [createLeafError("required", ["body"], 'must have required property "bark"')],
          { index: 1, title: "Dog" },
        ),
      ],
      { matchCount: 0 },
    ),
  ]);
}

describe("formatText", () => {
  it("renders a 4-level tree with nested indentation and codes", () => {
    const out = formatText(sampleTree());
    const lines = out.split("\n");
    expect(lines[0]).toBe("body request body invalid [body]");
    expect(lines[1]).toBe("  body must match exactly one of 2 schemas [oneOf]");
    expect(lines[2]).toBe("    body branch 0 (Cat) failed [branch]");
    expect(lines[3]).toBe("      body.purr must be boolean [type]");
    expect(lines[4]).toBe("    body branch 1 (Dog) failed [branch]");
    expect(lines[5]).toBe('      body must have required property "bark" [required]');
  });

  it("truncates at maxDepth with an ellipsis marker", () => {
    const out = formatText(sampleTree(), { maxDepth: 2 });
    const lines = out.split("\n");
    expect(lines).toContain("      …");
    for (const line of lines) {
      expect(line).not.toContain("must be boolean");
    }
    // Boundary: depth==maxDepth must still render (the rule is `depth >
    // maxDepth`, not `>=`). Pin it so an off-by-one regression here would
    // be caught.
    expect(lines).toContain("    body branch 0 (Cat) failed [branch]");
    expect(lines).toContain("    body branch 1 (Dog) failed [branch]");
  });

  it("allows overriding the indent string", () => {
    const out = formatText(sampleTree(), { indent: "\t" });
    expect(out.split("\n")[1]).toMatch(/^\tbody must match/);
  });

  it("omits the path prefix when the path is empty", () => {
    const tree = createLeafError("internal", [], "something broke");
    expect(formatText(tree)).toBe("something broke [internal]");
  });
});

describe("countErrors", () => {
  it("counts branches and leaves", () => {
    expect(countErrors(sampleTree())).toBe(6);
  });
});

describe("toJsonObject", () => {
  it("returns a tree that survives JSON.stringify → JSON.parse", () => {
    const tree = sampleTree();
    const roundTripped = JSON.parse(JSON.stringify(toJsonObject(tree)));
    expect(roundTripped).toEqual(tree);
  });

  it("deep-copies children and params", () => {
    const tree = sampleTree();
    const cloned = toJsonObject(tree);
    expect(cloned).not.toBe(tree);
    expect(cloned.children).not.toBe(tree.children);
    const firstChild = cloned.children[0];
    if (firstChild === undefined) throw new Error("unreachable");
    firstChild.message = "mutated";
    expect(tree.children[0]?.message).not.toBe("mutated");
  });
});

describe("formatSummary", () => {
  it('defaults to "first" and picks the first leaf in tree-traversal order', () => {
    expect(formatSummary(sampleTree())).toBe("body.purr must be boolean");
  });

  it('"deepest" picks the leaf with the longest path', () => {
    const tree = createBranchError("body", ["body"], "bad", [
      createLeafError("required", ["body"], "missing name"),
      createLeafError("type", ["body", "items", 3, "name"], "must be string"),
    ]);
    expect(formatSummary(tree, { select: "first" })).toBe("body missing name");
    expect(formatSummary(tree, { select: "deepest" })).toBe("body.items[3].name must be string");
  });

  it('"all" enumerates every leaf, one per line', () => {
    const out = formatSummary(sampleTree(), { select: "all" });
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("body.purr must be boolean [type]");
    expect(lines[1]).toBe('body must have required property "bark" [required]');
  });

  it('"all" honors a custom separator', () => {
    const out = formatSummary(sampleTree(), { select: "all", separator: ", " });
    expect(out).toBe(
      'body.purr must be boolean [type], body must have required property "bark" [required]',
    );
  });

  it('"all" suppresses the trailing [code] when includeCode is false', () => {
    const out = formatSummary(sampleTree(), { select: "all", includeCode: false });
    const lines = out.split("\n");
    expect(lines).toEqual(["body.purr must be boolean", 'body must have required property "bark"']);
  });

  it('"all" with eov-shape options composes separator + includeCode orthogonally', () => {
    const out = formatSummary(sampleTree(), {
      select: "all",
      separator: ", ",
      includeCode: false,
    });
    expect(out).toBe('body.purr must be boolean, body must have required property "bark"');
  });

  it("separator and includeCode have no effect on single-leaf modes", () => {
    const tree = sampleTree();
    const opts = { separator: ", ", includeCode: false } as const;
    expect(formatSummary(tree, { select: "first", ...opts })).toBe(
      formatSummary(tree, { select: "first" }),
    );
    expect(formatSummary(tree, { select: "deepest", ...opts })).toBe(
      formatSummary(tree, { select: "deepest" }),
    );
  });

  it("byCode returns the first leaf matching the highest-priority listed code", () => {
    const tree = createBranchError("request", [], "request invalid", [
      createLeafError("type", ["body", "age"], "must be number"),
      createLeafError("content-type", ["body"], 'Content-Type "text/plain" not accepted'),
      createLeafError("required", ["body"], "missing name"),
    ]);
    expect(formatSummary(tree, { select: { byCode: ["content-type", "required"] } })).toBe(
      'body Content-Type "text/plain" not accepted',
    );
    expect(formatSummary(tree, { select: { byCode: ["required", "content-type"] } })).toBe(
      "body missing name",
    );
  });

  it('byCode falls back to "first" when no leaf matches any listed code', () => {
    const tree = createLeafError("type", ["body", "age"], "must be number");
    expect(formatSummary(tree, { select: { byCode: ["content-type", "security"] } })).toBe(
      "body.age must be number",
    );
  });

  it("renders a path-less leaf as just the message", () => {
    const tree = createLeafError("route", [], "no matching route");
    expect(formatSummary(tree)).toBe("no matching route");
  });
});

describe("formatSummary path-less leaf", () => {
  it("renders a path-less leaf as just the message", () => {
    const tree = createLeafError("route", [], "no matching route");
    expect(formatSummary(tree)).toBe("no matching route");
  });
});
