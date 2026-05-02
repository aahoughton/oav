/* eslint-disable unicorn/no-thenable -- `then` is a JSON Schema keyword here */
import { describe, expect, it } from "vitest";
import type { SchemaOrBoolean } from "@oav/core";
import { compileSchema } from "../src/compiler/compiler.js";
import { jsonSchemaDialect, oas30Dialect, openapi31Dialect } from "../src/keywords/vocabulary.js";

describe("strict mode", () => {
  const lint = (schema: SchemaOrBoolean, mode?: "off" | "warn-partial" | "strict") =>
    compileSchema(schema, { dialect: jsonSchemaDialect, strict: mode }).stats.strictIssues;

  // Schemas that use $dynamicRef need a $dynamicAnchor somewhere
  // reachable. A self-anchored root works for both test cases.
  const dynamicSchema = {
    $dynamicAnchor: "meta",
    properties: { next: { $dynamicRef: "#meta" } },
    minimumx: 5, // also a typo
  } as unknown as SchemaOrBoolean;

  it("defaults to warn-partial: flags $dynamicRef but not unknown keywords", () => {
    const issues = compileSchema(dynamicSchema, { dialect: jsonSchemaDialect }).stats.strictIssues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "partial-feature",
      keyword: "$dynamicRef",
    });
  });

  it('"off" produces no issues even for clear problems', () => {
    const issues = lint(dynamicSchema, "off");
    expect(issues).toEqual([]);
  });

  it('"strict" flags unknown keywords in addition to partial features', () => {
    const issues = lint({ minimumx: 5, minimum: 0 } as unknown as SchemaOrBoolean, "strict");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "unknown-keyword",
      keyword: "minimumx",
    });
    expect(issues[0]?.message).toContain("<root>");
  });

  it('"strict" tolerates x-* extensions', () => {
    const issues = lint(
      { "x-codeSamples": [{ lang: "ts", source: "" }], minimum: 0 } as unknown as SchemaOrBoolean,
      "strict",
    );
    expect(issues).toEqual([]);
  });

  it('"strict" tolerates the JSON Schema 2020-12 content vocabulary', () => {
    const issues = lint(
      {
        type: "string",
        contentEncoding: "base64",
        contentMediaType: "application/jwt",
        contentSchema: { type: "object" },
      } as unknown as SchemaOrBoolean,
      "strict",
    );
    expect(issues).toEqual([]);
  });

  it('"strict" tolerates `xml` and `externalDocs` under the OpenAPI dialects', () => {
    const schema = {
      type: "string",
      xml: { name: "Msg" },
      externalDocs: { url: "https://example.com/docs" },
    } as unknown as SchemaOrBoolean;
    // Base JSON Schema dialect does NOT recognise `xml` / `externalDocs`;
    // they're OpenAPI extensions, not core JSON Schema keywords.
    const baseIssues = compileSchema(schema, {
      dialect: jsonSchemaDialect,
      strict: "strict",
    }).stats.strictIssues;
    expect(baseIssues.map((i) => i.keyword).sort()).toEqual(["externalDocs", "xml"]);
    // Both OpenAPI dialects DO recognise them.
    for (const dialect of [openapi31Dialect, oas30Dialect]) {
      const issues = compileSchema(schema, { dialect, strict: "strict" }).stats.strictIssues;
      expect(issues).toEqual([]);
    }
  });

  it('"strict" tolerates the standard $-prefixed metadata keys', () => {
    const issues = lint(
      {
        $id: "https://example.com/s",
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $comment: "note",
        $defs: { x: { type: "string" } },
        title: "t",
      } as unknown as SchemaOrBoolean,
      "strict",
    );
    expect(issues).toEqual([]);
  });

  it("walks into nested subschema positions", () => {
    const issues = lint(
      {
        properties: {
          a: { type: "string", minLenght: 3 }, // typo
        },
      } as unknown as SchemaOrBoolean,
      "strict",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "unknown-keyword",
      keyword: "minLenght",
      path: "properties.a",
    });
  });

  it("tolerates `then` / `else` alongside `if` via implements", () => {
    const schema = {
      if: { type: "string" },
      then: { minLength: 1 },
      else: { type: "number" },
    } as unknown as SchemaOrBoolean;
    expect(lint(schema, "strict")).toEqual([]);
  });

  it("does not descend into `enum` / `const` / `default` values", () => {
    // Literal values happen to contain a key called `minimumx`; the
    // linter must not mistake them for schema objects.
    const issues = lint(
      {
        const: { minimumx: 5 },
        enum: [{ minimumx: 5 }, { nopenotaschema: true }],
      } as unknown as SchemaOrBoolean,
      "strict",
    );
    expect(issues).toEqual([]);
  });
});
