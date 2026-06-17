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
import type { SchemaOrBoolean } from "@oav/core";
import { type Dialect, jsonSchemaDialect } from "@oav/schema";
import { classify } from "../classifier/index.js";
import { SpineValidator, type SpineVerdict, type Violation } from "../spine/index.js";
import { JsonParseError, JsonTokenizer } from "../tokenizer/index.js";
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

    // Compile-time fast-fail (invariant 2): classify before any byte.
    const classification = classify(schema, {
      dialect: options.dialect ?? jsonSchemaDialect,
      customKeywords: options.keywords === undefined ? undefined : Object.keys(options.keywords),
      parity: options.parity,
      strict: options.strict,
    });
    if (!classification.fullyStreamable) {
      throw new Error(
        "stream-validator: schema requires TEE/BUFFER handling, not supported in this build step",
      );
    }

    this.spine = new SpineValidator(schema, { onViolation: (v) => this.handleViolation(v) });
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
      if (err instanceof JsonParseError) {
        this.finished = true;
        this.rejectResult(err);
        cb(err); // fatal: destroys the stream, emits 'error'
        return;
      }
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
        if (err instanceof JsonParseError) {
          this.finished = true;
          this.rejectResult(err);
          cb(err);
          return;
        }
        cb(err as Error);
        return;
      }
    }
    const verdict = this.spine.verdict();
    this.finished = true;
    this.emit("verdict", verdict);
    this.resolveResult(verdict);
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
