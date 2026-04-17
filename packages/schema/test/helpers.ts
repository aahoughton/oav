import { compileSchema, type CompileOptions } from "../src/compiler/compiler.js";
import type { SchemaOrBoolean } from "@oav/core";
import { jsonSchemaDialect } from "../src/keywords/vocabulary.js";

/**
 * Compile a schema with the default JSON Schema 2020-12 dialect and
 * return the validator. Used by keyword tests so they don't repeat the
 * options boilerplate.
 */
export function compile(
  schema: SchemaOrBoolean,
  overrides: Partial<CompileOptions> = {},
): ReturnType<typeof compileSchema> {
  return compileSchema(schema, {
    dialect: jsonSchemaDialect,
    ...overrides,
  });
}
