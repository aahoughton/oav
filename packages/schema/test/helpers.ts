import { compileSchema, type CompileOptions } from "../src/compiler/compiler.js";
import type { SchemaOrBoolean } from "@oav/core";
import { defaultVocabularies } from "../src/keywords/vocabulary.js";

/**
 * Compile a schema with the default (validation + applicator + format)
 * vocabularies and return the validator. Used by keyword tests so they
 * don't repeat the options boilerplate.
 */
export function compile(
  schema: SchemaOrBoolean,
  overrides: Partial<CompileOptions> = {},
): ReturnType<typeof compileSchema> {
  return compileSchema(schema, {
    vocabularies: defaultVocabularies,
    ...overrides,
  });
}
