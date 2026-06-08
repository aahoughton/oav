import { describe, expect, it } from "vitest";
import { compileSchema, jsonSchemaDialect } from "../src/index.js";

type Err = { code: string; path: readonly (string | number)[]; children?: readonly Err[] };

function walkLeaves(err: Err, acc: Err[] = []): Err[] {
  if ((err.children ?? []).length === 0) acc.push(err);
  for (const c of err.children ?? []) walkLeaves(c, acc);
  return acc;
}

describe("error paths survive path-array reuse", () => {
  // Regression probe for the lazy-path optimization. Generated
  // validators traverse a shared mutable path array (push/pop around
  // function-call boundaries); errors constructed inside a callee
  // must snapshot the path so the caller's subsequent pop doesn't
  // silently rewrite the error's .path.
  it("a type error inside items[0] stays at [0] after items[1] runs", () => {
    const { validate } = compileSchema(
      {
        type: "array",
        items: {
          type: "object",
          properties: { x: { type: "number" } },
          required: ["x"],
        },
      },
      { dialect: jsonSchemaDialect, output: "tree", maxErrors: Number.POSITIVE_INFINITY },
    );
    const r = validate(["not-an-object", { x: "bad" }]);
    if (r.valid) throw new Error("unexpected valid");
    const leaves = walkLeaves(r.error! as Err);
    const typeErr = leaves.find((e) => e.code === "type" && e.path.length > 0);
    expect(typeErr?.path).toEqual([0]);
  });

  // Regression probe for the inline-pathSegments optimization (#50).
  // A single-keyword leaf inlined with a pending segment must place
  // the segment in its error's .path; the inliner no longer
  // pre-materializes `[...path, seg]` for the inner ctx, so a leaf
  // that forgets to splice its pending segment would drop it.
  it("inlined const under properties reports path ['kind']", () => {
    const { validate } = compileSchema(
      {
        type: "object",
        properties: { kind: { const: "Cat" } },
      },
      { dialect: jsonSchemaDialect, output: "tree", maxErrors: Number.POSITIVE_INFINITY },
    );
    const r = validate({ kind: "Dog" });
    if (r.valid) throw new Error("unexpected valid");
    const leaves = walkLeaves(r.error! as Err);
    const constErr = leaves.find((e) => e.code === "const");
    expect(constErr?.path).toEqual(["kind"]);
  });

  // Regression probe for the multi-keyword inline wrap. When an
  // inlined subschema has 2+ keywords that both fail, the wrap
  // branch error should live at the extended path too, not at the
  // caller's unextended path.
  it("inlined multi-keyword wrap reports path ['fins']", () => {
    const { validate } = compileSchema(
      {
        type: "object",
        properties: { fins: { type: "integer", minimum: 0 } },
      },
      { dialect: jsonSchemaDialect, output: "tree", maxErrors: Number.POSITIVE_INFINITY },
    );
    const r = validate({ fins: -1.5 });
    if (r.valid) throw new Error("unexpected valid");
    // Two inlined leaves (type + minimum) wrapped in a "schema"
    // branch; `wrapErrors` unwraps single-child, so the root error
    // IS that "schema" branch.
    const root = r.error! as Err;
    expect(root.code).toBe("schema");
    expect(root.path).toEqual(["fins"]);
    const leaves = walkLeaves(root);
    for (const leaf of leaves) {
      expect(leaf.path).toEqual(["fins"]);
    }
  });

  // Regression probe: inlined `required` under a segmented
  // validateSubschema call must splice BOTH the caller's pending
  // segment and its own missing-property segment (2 trailing
  // segments). Exercises the extraSegment2 codepath in the runtime
  // helper.
  it("inlined required reports path [<key>, <missing>]", () => {
    const { validate } = compileSchema(
      {
        type: "object",
        properties: {
          user: {
            type: "object",
            required: ["id"],
          },
        },
      },
      { dialect: jsonSchemaDialect, output: "tree", maxErrors: Number.POSITIVE_INFINITY },
    );
    const r = validate({ user: {} });
    if (r.valid) throw new Error("unexpected valid");
    const leaves = walkLeaves(r.error! as Err);
    const requiredErr = leaves.find((e) => e.code === "required");
    expect(requiredErr?.path).toEqual(["user", "id"]);
  });
});
