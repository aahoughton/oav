/**
 * The streaming validator engine: a Node `Transform` that echoes input
 * bytes through unchanged while validating them against a resolved schema
 * on a side channel.
 *
 * Channels (design "Channels and events"):
 *
 *   - the **output byte stream**: input bytes, verbatim (invariant 1);
 *   - **`violation`** events: a well-formed value that failed the schema,
 *     non-fatal, up to `maxErrors`, each carrying a byte offset;
 *   - **`error`** (Node's terminal channel): a fatal parse / I/O failure;
 *   - **`verdict`** events + the {@link StreamValidator.result} promise:
 *     the final valid/invalid result, delivered as both.
 *
 * Terminal policy (design "Two lifecycles and terminal policy"): the
 * default is `terminate` with `maxErrors: 1` (the budget-th violation
 * destroys the stream with {@link ValidationFailedError}, so a
 * `pipeline` rejects); `detach` instead seals the verdict and raw-copies
 * the tail. A parse error is always terminal.
 *
 * This build step handles fully-STREAM schemas. A schema needing
 * TEE/BUFFER, or an unsupported/unknown keyword, fails fast at
 * construction (invariant 2) rather than partway through a body.
 *
 * @packageDocumentation
 */

import { Transform, type TransformCallback } from "node:stream";
import type { PathSegment, SchemaObject, SchemaOrBoolean } from "@oav/core";
import { compileSchema, type Dialect, jsonSchemaDialect } from "@oav/schema";
import { classify } from "../classifier/index.js";
import {
  type IslandDelegate,
  SpineValidator,
  type SpineVerdict,
  type Violation,
} from "../spine/index.js";
import { JsonTokenizer } from "../tokenizer/index.js";
import type { StreamValidatorOptions } from "../options.js";

/**
 * A terminal validation failure under `terminate` policy: the input was
 * well-formed JSON but did not satisfy the schema. Distinct from a parse
 * / I/O `error`; carries the verdict.
 *
 * @public
 */
export class ValidationFailedError extends Error {
  readonly verdict: SpineVerdict;
  constructor(verdict: SpineVerdict) {
    super(`stream validation failed with ${verdict.violations.length} violation(s)`);
    this.name = "ValidationFailedError";
    this.verdict = verdict;
  }
}

/** Options for {@link createStreamValidator}, plus the classifier dialect. */
export interface CreateStreamValidatorOptions extends StreamValidatorOptions {
  /** Dialect whose keyword set drives classification. Default `jsonSchemaDialect`. */
  dialect?: Dialect;
}

type CompiledValidator = (
  data: unknown,
  startPath?: readonly PathSegment[],
) => { valid: true } | { valid: false; errors: { code: string; path: PathSegment[] }[] };

/**
 * Build the island delegate: validate a materialized subtree against the
 * in-memory engine, compiling each schema node once and caching it. Local
 * `$ref`s are resolved by attaching the document root's `$defs` to the
 * compiled subschema (so `#/$defs/...` resolves; a self-`#` ref inside an
 * island is the documented edge case).
 */
function buildDelegate(
  root: SchemaOrBoolean,
  options: CreateStreamValidatorOptions,
): IslandDelegate {
  const rootDefs =
    typeof root === "object" && root !== null && !Array.isArray(root)
      ? (root as SchemaObject).$defs
      : undefined;
  const dialect = options.dialect ?? jsonSchemaDialect;
  const cache = new Map<SchemaObject, CompiledValidator>();

  const compile = (schema: SchemaObject): CompiledValidator => {
    let v = cache.get(schema);
    if (v === undefined) {
      const doc: SchemaObject = rootDefs === undefined ? schema : { ...schema, $defs: rootDefs };
      v = compileSchema(doc as never, {
        dialect,
        maxErrors: Number.POSITIVE_INFINITY,
        ...(options.formats === undefined ? {} : { formats: options.formats }),
        ...(options.regexCompiler === undefined ? {} : { regexCompiler: options.regexCompiler }),
        ...(options.keywords === undefined ? {} : { keywords: options.keywords }),
      }).validate as CompiledValidator;
      cache.set(schema, v);
    }
    return v;
  };

  return (schemas, value, startPath, byteOffset) => {
    const out: Violation[] = [];
    for (const schema of schemas) {
      const result = compile(schema)(value, startPath);
      if (!result.valid) {
        for (const e of result.errors) out.push({ code: e.code, path: e.path, byteOffset });
      }
    }
    return out;
  };
}

/**
 * A streaming validator. Pipe bytes in, get the same bytes out; observe
 * `violation` / `verdict` events, or await {@link StreamValidator.result}.
 *
 * @public
 */
export class StreamValidator extends Transform {
  private readonly spine: SpineValidator;
  private readonly tokenizer: JsonTokenizer;
  private readonly maxErrors: number;
  private readonly policy: "terminate" | "detach";

  private errorCount = 0;
  private sealed = false; // detach: validation stopped, echo-only tail
  private finished = false; // verdict settled
  private budgetHit = false; // set inside a write; acted on after it returns

  /** Resolves with the final verdict (rejects on a fatal parse / I/O error). */
  readonly result: Promise<SpineVerdict>;
  private resolveResult!: (v: SpineVerdict) => void;
  private rejectResult!: (err: Error) => void;

  constructor(schema: SchemaOrBoolean, options: CreateStreamValidatorOptions = {}) {
    super();
    this.maxErrors = options.maxErrors ?? 1;
    this.policy = options.policy ?? "terminate";

    // Compile-time fast-fail (invariant 2): classify before any byte. A
    // REJECT keyword (`unevaluated*`), an unknown keyword, or an
    // unresolvable `$ref` throws here, naming the keyword + path.
    const classification = classify(schema, {
      dialect: options.dialect ?? jsonSchemaDialect,
      customKeywords: options.keywords === undefined ? undefined : Object.keys(options.keywords),
      parity: options.parity,
      strict: options.strict,
    });

    this.spine = new SpineValidator(schema, {
      onViolation: (v) => this.handleViolation(v),
      strategyOf: classification.strategyOf,
      delegate: buildDelegate(schema, options),
      ...(options.maxBufferedBytes === undefined
        ? {}
        : { maxBufferedBytes: options.maxBufferedBytes }),
    });
    this.tokenizer = new JsonTokenizer(this.spine);
    this.result = new Promise<SpineVerdict>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
  }

  private handleViolation(violation: Violation): void {
    this.errorCount += 1;
    this.emit("violation", violation);
    if (this.errorCount >= this.maxErrors) this.budgetHit = true;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    // Echo first: output is the verbatim input byte stream (invariant 1).
    this.push(chunk);
    if (this.sealed || this.finished) {
      cb();
      return;
    }
    try {
      this.tokenizer.write(chunk);
    } catch (err) {
      // Fatal: a parse error or a buffer-limit overflow. Destroys the
      // stream, emits 'error', and rejects the result promise.
      this.finished = true;
      this.rejectResult(err as Error);
      cb(err as Error);
      return;
    }
    if (this.budgetHit) this.applyBudget(cb);
    else cb();
  }

  override _flush(cb: TransformCallback): void {
    if (this.finished) {
      cb();
      return;
    }
    if (!this.sealed) {
      try {
        this.tokenizer.end();
      } catch (err) {
        this.finished = true;
        this.rejectResult(err as Error);
        cb(err as Error);
        return;
      }
    }
    const verdict = this.spine.verdict();
    this.finished = true;
    this.emit("verdict", verdict);
    this.resolveResult(verdict);
    // Violations that only surface at close (a top-level scalar, an
    // under-limit like `required` / `minItems`) reach terminate here.
    if (this.policy === "terminate" && !verdict.valid) {
      cb(new ValidationFailedError(verdict));
      return;
    }
    cb();
  }

  // The validation budget was reached mid-write: under `terminate`, fail
  // the stream now; under `detach`, seal the verdict and echo the tail.
  private applyBudget(cb: TransformCallback): void {
    const verdict = this.spine.verdict();
    if (this.policy === "terminate") {
      this.finished = true;
      this.emit("verdict", verdict);
      this.resolveResult(verdict);
      const err = new ValidationFailedError(verdict);
      cb(err);
      return;
    }
    // detach: stop validating, keep echoing.
    this.sealed = true;
    cb();
  }
}

/**
 * Create a {@link StreamValidator} for `schema`. Throws at construction
 * (before any byte) if the schema cannot be soundly streamed.
 *
 * @public
 */
export function createStreamValidator(
  schema: SchemaOrBoolean,
  options?: CreateStreamValidatorOptions,
): StreamValidator {
  return new StreamValidator(schema, options);
}
