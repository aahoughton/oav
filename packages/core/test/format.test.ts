import { describe, expect, it } from "vitest";
import { createBranchError, createLeafError, type ValidationError } from "../src/errors.js";
import { countErrors, formatFlat, formatJson, formatText } from "../src/format.js";

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
    expect(lines[0]).toBe("body — request body invalid [body]");
    expect(lines[1]).toBe("  body — must match exactly one of 2 schemas [oneOf]");
    expect(lines[2]).toBe("    body — branch 0 (Cat) failed [branch]");
    expect(lines[3]).toBe("      body.purr — must be boolean [type]");
    expect(lines[4]).toBe("    body — branch 1 (Dog) failed [branch]");
    expect(lines[5]).toBe('      body — must have required property "bark" [required]');
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
    expect(lines).toContain("    body — branch 0 (Cat) failed [branch]");
    expect(lines).toContain("    body — branch 1 (Dog) failed [branch]");
  });

  it("allows overriding the indent string", () => {
    const out = formatText(sampleTree(), { indent: "\t" });
    expect(out.split("\n")[1]).toMatch(/^\tbody — must match/);
  });

  it("omits the path prefix when the path is empty", () => {
    const tree = createLeafError("internal", [], "something broke");
    expect(formatText(tree)).toBe("something broke [internal]");
  });
});

describe("formatJson", () => {
  it("returns a tree that survives JSON.stringify → JSON.parse", () => {
    const tree = sampleTree();
    const roundTripped = JSON.parse(JSON.stringify(formatJson(tree)));
    expect(roundTripped).toEqual(tree);
  });

  it("deep-copies children and params", () => {
    const tree = sampleTree();
    const cloned = formatJson(tree);
    expect(cloned).not.toBe(tree);
    expect(cloned.children).not.toBe(tree.children);
    const firstChild = cloned.children[0];
    if (firstChild === undefined) throw new Error("unreachable");
    firstChild.message = "mutated";
    expect(tree.children[0]?.message).not.toBe("mutated");
  });
});

describe("formatFlat", () => {
  it("emits exactly one line per leaf, not per branch", () => {
    const out = formatFlat(sampleTree());
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("body.purr — must be boolean [type]");
    expect(lines[1]).toBe('body — must have required property "bark" [required]');
  });

  it("flattens deep nesting to a single leaf-per-line report", () => {
    let node: ValidationError = createLeafError("type", ["deep", "x"], "bad");
    for (let i = 0; i < 10; i += 1) {
      node = createBranchError(`level-${i}`, [], "branch", [node]);
    }
    expect(formatFlat(node)).toBe("deep.x — bad [type]");
  });
});

describe("countErrors", () => {
  it("counts branches and leaves", () => {
    expect(countErrors(sampleTree())).toBe(6);
  });
});
