import type { SchemaObject, SchemaOrBoolean, ValidationError } from "@oav/core";
import { CodeGen, NAMES, quoteString } from "../codegen/index.js";
import type { KeywordDefinition, Vocabulary } from "../keywords/types.js";
import { createKeywordContext } from "../keywords/context.js";
import { createRefResolver, resolve, type RefResolver } from "../resolve/index.js";
import { createDeps, type ValidatorDeps } from "./runtime.js";

/**
 * Result of compiling a JSON Schema 2020-12 document. The shape mirrors what
 * the user-facing validator in `@oav/validator` wants: a `{ valid, error? }`
 * object.
 *
 * @public
 */
export interface ValidationResult {
  valid: boolean;
  error?: ValidationError;
}

/**
 * The function returned by {@link compileSchema}. Call it with any JSON value
 * to validate against the original schema.
 *
 * @public
 */
export type CompiledSchema = {
  validate: (data: unknown) => ValidationResult;
  /** The generated source. Exposed for debugging/snapshot testing only. */
  source: string;
};

/**
 * Options accepted by {@link compileSchema}.
 *
 * @public
 */
export interface CompileOptions {
  /** The set of vocabularies whose keywords are available. */
  vocabularies: Vocabulary[];
  /** Additional external named schemas that `$ref` can resolve to. */
  external?: Map<string, SchemaOrBoolean>;
  /** Pre-registered format validators, keyed by format name. */
  formats?: Record<string, (value: string) => boolean>;
  /** Extra runtime deps to merge into the compiled closure. Used for tests. */
  extraDeps?: Partial<ValidatorDeps>;
  /** Custom ref resolver — overrides the default (which resolves fragments within the root). */
  refResolver?: RefResolver;
}

/** @internal */
export interface CompileState {
  readonly gen: CodeGen;
  readonly byKeyword: Map<string, KeywordDefinition>;
  readonly ordered: KeywordDefinition[];
  readonly compiledFor: Map<SchemaOrBoolean, string>;
  readonly functionBodies: string[];
  readonly deps: ValidatorDeps;
  readonly refResolver: RefResolver;
  readonly compileValidator: (schema: SchemaOrBoolean) => string;
  nextFn: number;
}

type WrapperCode = "schema" | "not" | "ref";

/**
 * Compile a JSON Schema 2020-12 document into an executable validator.
 *
 * @param schema - The schema (object or boolean) to compile.
 * @param options - Vocabularies, formats, external schemas.
 * @returns A validator function plus the generated source.
 *
 * @example
 * ```ts
 * const v = compileSchema({ type: "number" }, { vocabularies: [core] });
 * v.validate(1.5); // { valid: true }
 * v.validate("x"); // { valid: false, error: { code: "type", ... } }
 * ```
 *
 * @public
 */
export function compileSchema(schema: SchemaOrBoolean, options: CompileOptions): CompiledSchema {
  const byKeyword = new Map<string, KeywordDefinition>();
  const ordered: KeywordDefinition[] = [];
  for (const vocab of options.vocabularies) {
    for (const kw of vocab.keywords) {
      if (byKeyword.has(kw.keyword)) continue;
      byKeyword.set(kw.keyword, kw);
      ordered.push(kw);
    }
  }

  const deps = createDeps();
  if (options.formats) {
    for (const name of Object.keys(options.formats)) {
      const fn = options.formats[name];
      if (fn !== undefined) deps.formats.set(name, fn);
    }
  }
  if (options.extraDeps) Object.assign(deps, options.extraDeps);

  const graph = resolve(schema);
  if (options.external !== undefined) {
    for (const [uri, ext] of options.external) {
      if (!graph.registry.has(uri)) graph.registry.add(uri, ext);
    }
  }
  const refResolver = options.refResolver ?? createRefResolver(graph);

  const state: CompileState = {
    gen: new CodeGen(),
    byKeyword,
    ordered,
    compiledFor: new Map(),
    functionBodies: [],
    deps,
    refResolver,
    nextFn: 0,
    compileValidator(sub) {
      return compileValidator(sub, state);
    },
  };

  const rootName = compileValidator(schema, state);

  const wholeSource = assembleSource(state, rootName);
  const factory = new Function(NAMES.DEPS, wholeSource) as (deps: ValidatorDeps) => CompiledFactory;
  const { validate } = factory(deps);
  return { validate, source: wholeSource };
}

interface CompiledFactory {
  validate: (data: unknown) => ValidationResult;
}

function compileValidator(schema: SchemaOrBoolean, state: CompileState): string {
  const cached = state.compiledFor.get(schema);
  if (cached !== undefined) return cached;

  const name = `validate_${state.nextFn}`;
  state.nextFn += 1;
  state.compiledFor.set(schema, name);

  const body = buildFunctionBody(schema, state, "schema");
  state.functionBodies.push(`function ${name}(${NAMES.DATA}, ${NAMES.PATH}) {\n${body}\n}`);
  return name;
}

function buildFunctionBody(
  schema: SchemaOrBoolean,
  state: CompileState,
  wrapCode: WrapperCode,
): string {
  const gen = new CodeGen();
  gen.indent();
  gen.const(NAMES.ERRORS, "[]");

  if (schema === true) {
    // no-op; always valid
  } else if (schema === false) {
    gen.line(
      `${NAMES.ERRORS}.push(${NAMES.DEPS}.createLeafError("false", ${NAMES.PATH}, "schema is false, nothing is valid"));`,
    );
  } else {
    compileSchemaKeywords(schema, gen, state);
  }

  gen.line(
    `return ${NAMES.DEPS}.wrapErrors(${quoteString(wrapCode)}, ${NAMES.PATH}, ${NAMES.ERRORS});`,
  );
  gen.dedent();
  return gen.toString();
}

function compileSchemaKeywords(schema: SchemaObject, gen: CodeGen, state: CompileState): void {
  const subCompiler = (subSchema: SchemaOrBoolean): string => compileValidator(subSchema, state);
  const resolveRefToFunction = (ref: string): string => {
    const target = state.refResolver.resolve(ref);
    return compileValidator(target, state);
  };

  const seen = new Set<string>();
  for (const kw of state.ordered) {
    if (seen.has(kw.keyword)) continue;
    if (!(kw.keyword in schema)) continue;
    const schemaValue = (schema as Record<string, unknown>)[kw.keyword];
    const ctx = createKeywordContext({
      gen,
      schema: schemaValue,
      parentSchema: schema,
      data: NAMES.DATA,
      path: NAMES.PATH,
      errors: NAMES.ERRORS,
      subschema: subCompiler,
      resolveRef: resolveRefToFunction,
    });
    kw.compile(ctx);
    seen.add(kw.keyword);
    if (kw.implements) for (const impl of kw.implements) seen.add(impl);
  }
}

function assembleSource(state: CompileState, rootName: string): string {
  const parts: string[] = [];
  parts.push(`"use strict";`);
  parts.push("");
  parts.push(...state.functionBodies);
  parts.push("");
  parts.push(`function validate(${NAMES.DATA}) {`);
  parts.push(`  const err = ${rootName}(${NAMES.DATA}, []);`);
  parts.push(`  if (err === null) return { valid: true };`);
  parts.push(`  return { valid: false, error: err };`);
  parts.push(`}`);
  parts.push("return { validate };");
  return parts.join("\n");
}
