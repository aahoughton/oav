import { describe, expect, it } from "vitest";
import { compileSchema, jsonSchemaDialect } from "../src/index.js";

type Err = { code: string; path: readonly (string | number)[]; children?: readonly Err[] };

function walkLeaves(err: Err, acc: Err[] = []): Err[] {
  if ((err.children ?? []).length === 0) acc.push(err);
  for (const c of err.children ?? []) walkLeaves(c, acc);
  return acc;
}

describe("error paths survive path-array reuse", () => {
  // Regression probe for the lazy-path optimisation. Generated
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
      { dialect: jsonSchemaDialect },
    );
    const r = validate(["not-an-object", { x: "bad" }]);
    if (r.valid) throw new Error("unexpected valid");
    const leaves = walkLeaves(r.error! as Err);
    const typeErr = leaves.find((e) => e.code === "type" && e.path.length > 0);
    expect(typeErr?.path).toEqual([0]);
  });
});
