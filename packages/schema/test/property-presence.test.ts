import { describe, expect, it } from "vitest";
import { compileSchema } from "../src/compiler/compiler.js";
import { jsonSchemaDialect } from "../src/keywords/vocabulary.js";

function valid(schema: unknown, data: unknown): boolean {
  return compileSchema(schema as never, { dialect: jsonSchemaDialect }).validate(data).valid;
}

// Presence is checked with `data[key] !== undefined` for ordinary
// property names (cheaper than `hasOwnProperty`), falling back to
// `hasOwnProperty` for names that live on `Object.prototype`. These tests
// pin both the optimization's correctness and the resulting semantics:
// an `undefined`-valued property is treated as absent (matching JSON
// serialization, where `JSON.stringify` drops it).
describe("property presence semantics", () => {
  describe("undefined value is treated as absent", () => {
    it("required: an undefined-valued property counts as missing", () => {
      expect(valid({ required: ["foo"] }, { foo: undefined })).toBe(false);
    });

    it("required: a null-valued property counts as present", () => {
      expect(valid({ required: ["foo"] }, { foo: null })).toBe(true);
    });

    it("properties: an undefined-valued property is not validated (absent)", () => {
      expect(valid({ properties: { foo: { type: "string" } } }, { foo: undefined })).toBe(true);
    });

    it("properties: a null-valued property is validated (present)", () => {
      expect(valid({ properties: { foo: { type: "string" } } }, { foo: null })).toBe(false);
    });

    it("required + properties agree: undefined-valued required prop fails as missing", () => {
      const schema = { required: ["foo"], properties: { foo: { type: "string" } } };
      expect(valid(schema, { foo: undefined })).toBe(false);
    });

    it("dependentRequired: an undefined-valued trigger does not fire", () => {
      expect(valid({ dependentRequired: { a: ["b"] } }, { a: undefined })).toBe(true);
    });

    it("dependentRequired: a present trigger requires its companions", () => {
      expect(valid({ dependentRequired: { a: ["b"] } }, { a: 1 })).toBe(false);
    });
  });

  describe("inherited Object.prototype names use hasOwnProperty (not !== undefined)", () => {
    for (const name of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      it(`required: "${name}" is missing on a plain object`, () => {
        expect(valid({ required: [name] }, {})).toBe(false);
      });

      it(`properties: "${name}" subschema is not applied to an inherited member`, () => {
        // The object does not own "${name}"; the inherited member must not
        // be picked up and validated.
        expect(valid({ properties: { [name]: { type: "string" } } }, {})).toBe(true);
      });
    }

    it("required: an inherited name IS satisfied when actually present as an own property", () => {
      expect(valid({ required: ["toString"] }, { toString: "x" })).toBe(true);
    });

    it("required: mixing a safe and an inherited name still checks both", () => {
      expect(valid({ required: ["id", "toString"] }, { id: 1 })).toBe(false);
      expect(valid({ required: ["id", "toString"] }, { id: 1, toString: "x" })).toBe(true);
    });
  });
});
