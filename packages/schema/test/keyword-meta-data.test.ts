import { describe, expect, it } from "vitest";
import {
  descriptionKeyword,
  exampleKeyword,
  jsonSchemaDialect,
  metaDataVocabulary,
  oas30Dialect,
  openapi31Dialect,
  openapiMetaDataVocabulary,
} from "../src/keywords/index.js";
import { compile } from "./helpers.js";

describe("meta-data vocabulary", () => {
  it("registers the seven JSON Schema 2020-12 annotations as annotation: true", () => {
    expect(metaDataVocabulary.keywords).toHaveLength(7);
    for (const kw of metaDataVocabulary.keywords) {
      expect(kw.annotation).toBe(true);
    }
    expect(metaDataVocabulary.keywords.map((k) => k.keyword).sort()).toEqual([
      "default",
      "deprecated",
      "description",
      "examples",
      "readOnly",
      "title",
      "writeOnly",
    ]);
  });

  it("carries the spec's meta-data vocabulary URI", () => {
    expect(metaDataVocabulary.uri).toBe("https://json-schema.org/draft/2020-12/vocab/meta-data");
  });

  it("OpenAPI dialects extend the meta-data set with `example`", () => {
    expect(openapiMetaDataVocabulary.keywords.map((k) => k.keyword)).toEqual(["example"]);
    expect(exampleKeyword.annotation).toBe(true);
    for (const d of [openapi31Dialect, oas30Dialect]) {
      const has = (name: string) =>
        d.vocabularies.some((v) => v.keywords.some((k) => k.keyword === name));
      expect(has("description")).toBe(true);
      expect(has("example")).toBe(true);
    }
    // jsonSchemaDialect gets the Meta-Data vocab, but NOT the OpenAPI
    // `example` extension.
    const jsHas = (name: string) =>
      jsonSchemaDialect.vocabularies.some((v) => v.keywords.some((k) => k.keyword === name));
    expect(jsHas("description")).toBe(true);
    expect(jsHas("example")).toBe(false);
  });

  it("is a no-op at runtime — annotation-only schemas accept any input", () => {
    const v = compile({
      title: "X",
      description: "anything",
      default: 42,
      deprecated: true,
      readOnly: true,
      examples: [1, 2, 3],
      "x-ext": "ok",
    } as Record<string, unknown>);
    expect(v.validate(1).valid).toBe(true);
    expect(v.validate("str").valid).toBe(true);
    expect(v.validate(null).valid).toBe(true);
  });

  it("keywords expose annotation: true so the inliner can skip them", () => {
    // The subschema inliner reads kw.annotation to decide which keys
    // don't count as "real" validation keywords. Lock it in explicitly
    // so a refactor can't silently drop the flag.
    expect(descriptionKeyword.annotation).toBe(true);
  });
});
