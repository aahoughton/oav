import { describe, expect, it } from "vitest";
import { createBranchError, createLeafError } from "../src/errors.js";
import { collectIssues, toProblemDetails } from "../src/problem-details.js";

describe("collectIssues", () => {
  it("flattens a single leaf", () => {
    const err = createLeafError("type", ["body", "age"], "must be number", {
      expected: ["number"],
      actual: "string",
    });
    expect(collectIssues(err)).toEqual([
      {
        code: "type",
        path: ["body", "age"],
        pointer: "/body/age",
        message: "must be number",
        params: { expected: ["number"], actual: "string" },
      },
    ]);
  });

  it("flattens a branch's leaves in traversal order", () => {
    const root = createBranchError("body", ["body"], "bad body", [
      createLeafError("required", ["body"], "missing name", { missing: "name" }),
      createLeafError("type", ["body", "age"], "must be number", {
        expected: ["number"],
        actual: "string",
      }),
    ]);
    const issues = collectIssues(root);
    expect(issues).toHaveLength(2);
    expect(issues[0]?.code).toBe("required");
    expect(issues[1]?.code).toBe("type");
    expect(issues[1]?.pointer).toBe("/body/age");
  });

  it("encodes array indices as numeric path segments and numeric pointer tokens", () => {
    const err = createLeafError("type", ["body", "pets", 3, "name"], "must be string");
    const [issue] = collectIssues(err);
    expect(issue?.path).toEqual(["body", "pets", 3, "name"]);
    expect(issue?.pointer).toBe("/body/pets/3/name");
  });

  it("escapes `~` and `/` in path segments per RFC 6901", () => {
    const err = createLeafError("type", ["a/b", "c~d"], "x");
    const [issue] = collectIssues(err);
    expect(issue?.pointer).toBe("/a~1b/c~0d");
  });

  it("produces an empty pointer for a root-level error", () => {
    const err = createLeafError("type", [], "x");
    const [issue] = collectIssues(err);
    expect(issue?.pointer).toBe("");
  });
});

describe("toProblemDetails", () => {
  const err = createBranchError("body", ["body"], "bad body", [
    createLeafError("required", ["body"], "missing name", { missing: "name" }),
    createLeafError("type", ["body", "age"], "must be number", {
      expected: ["number"],
      actual: "string",
    }),
  ]);

  it("returns the RFC 9457 envelope with sensible defaults", () => {
    const pd = toProblemDetails(err);
    expect(pd.type).toBe("about:blank");
    expect(pd.title).toBe("Validation failed");
    expect(pd.status).toBe(400);
    // detail summarises the first leaf via formatSummary(); the structural
    // count is still in `issues.length` for callers that need it.
    expect(pd.detail).toBe("body missing name");
    expect(pd.instance).toBeUndefined();
    expect(pd.issues).toHaveLength(2);
  });

  it("uses the leaf's own message when the path is empty", () => {
    const pd = toProblemDetails(createLeafError("type", [], "x"));
    expect(pd.detail).toBe("x");
  });

  it("honors a caller-supplied `detail` override", () => {
    const pd = toProblemDetails(err, { detail: "2 validation errors" });
    expect(pd.detail).toBe("2 validation errors");
  });

  it("honors caller-supplied type / title / status / instance", () => {
    const pd = toProblemDetails(err, {
      type: "https://example.com/errors/validation",
      title: "Bad pets",
      status: 422,
      instance: "/pets?limit=10",
    });
    expect(pd.type).toBe("https://example.com/errors/validation");
    expect(pd.title).toBe("Bad pets");
    expect(pd.status).toBe(422);
    expect(pd.instance).toBe("/pets?limit=10");
  });

  it("round-trips through JSON.stringify", () => {
    const pd = toProblemDetails(err, { instance: "/x" });
    const round = JSON.parse(JSON.stringify(pd));
    expect(round).toEqual(pd);
  });
});
