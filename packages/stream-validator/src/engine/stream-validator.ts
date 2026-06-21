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
 * STREAM-classified values validate on the forward spine; non-stream
 * subtrees (composition, object/array equality, `dependentSchemas`,
 * `contains`, `uniqueItems`, `format` under an asserting dialect) are
 * materialized and delegated to `@oav/schema`'s in-memory engine. Only a
 * REJECT keyword (`unevaluated*`), an unknown keyword, or an unresolvable
 * `$ref` fails fast at construction (invariant 2). `maxBufferedBytes` /
 * `maxDepth` / `maxTotalBytes` bound memory; `regexCompiler` hardens
 * `pattern` against ReDoS.
 *
 * @packageDocumentation
 */

import { Transform, type TransformCallback } from "node:stream";
import type { PathSegment, SchemaObject, SchemaOrBoolean, ValidationError } from "@oav/core";
import {
  compileSchema,
  type Dialect,
  FORMAT_ASSERTION_VOCAB,
  jsonSchemaDialect,
  openapi31Dialect,
} from "@oav/schema";
import { normalizeOas30 } from "../openapi/index.js";
import { classify } from "../classifier/index.js";
import {
  BudgetReached,
  type IslandDelegate,
  type ScopeClose,
  SpineValidator,
  type StreamVerdict,
  type SchemaViolation,
} from "../spine/index.js";
import { JsonTokenizer } from "../tokenizer/index.js";
import type { JsonPath, PathFilter, StreamValidatorOptions } from "../options.js";
import {
  DEFAULT_MAX_CAPTURE_BYTES,
  makeScopeContext,
  type ScopeEditor,
  type ScopeObserver,
  toBuffer,
  type ValueEvent,
} from "./hooks.js";

/** Does a path filter match this scope path + kind? */
function matchPathFilter(
  filter: PathFilter,
  path: readonly PathSegment[],
  kind: "object" | "array",
): boolean {
  if (typeof filter === "function") return filter(path as JsonPath, kind);
  return filter.length === path.length && filter.every((seg, i) => seg === path[i]);
}

// Does a value-event filter match this member? The filter is matched
// against the member's full path (the enclosing scope path plus the key),
// so a filter targets a specific field rather than every member of a
// scope. The predicate form receives that full path with kind "object"
// (a value member is always an object member).
function matchValueFilter(
  filter: PathFilter,
  scopePath: readonly PathSegment[],
  key: string,
): boolean {
  if (typeof filter === "function") return filter([...scopePath, key] as JsonPath, "object");
  return (
    filter.length === scopePath.length + 1 &&
    filter.every((seg, i) => (i < scopePath.length ? seg === scopePath[i] : seg === key))
  );
}

/**
 * A terminal validation failure under `terminate` policy: the input was
 * well-formed JSON but did not satisfy the schema. Distinct from a parse
 * / I/O `error`; carries the verdict.
 *
 * @public
 */
export class ValidationFailedError extends Error {
  readonly verdict: StreamVerdict;
  constructor(verdict: StreamVerdict) {
    super(`stream validation failed with ${verdict.violations.length} violation(s)`);
    this.name = "ValidationFailedError";
    this.verdict = verdict;
  }
}

/**
 * Input exceeded the configured `maxTotalBytes`. Fatal, raised on the
 * `error` channel regardless of validity (a policy lever, not a schema
 * verdict).
 *
 * The total-size member of the package's resource-limit family
 * ({@link BufferLimitError}, {@link UniqueItemsLimitError}), so a caller
 * can `instanceof` any of them to tell "too big" from a
 * {@link ValidationFailedError} ("well-formed but invalid"), then read
 * `limit` for which cap tripped.
 *
 * @public
 */
export class MaxTotalBytesError extends Error {
  /** The `maxTotalBytes` value that was exceeded. */
  readonly limit: number;
  /** Stream-absolute byte count reached when the cap was crossed. */
  readonly byteOffset: number;
  constructor(limit: number, byteOffset: number) {
    super(`stream-validator: input exceeded maxTotalBytes=${limit} (at byte ${byteOffset})`);
    this.name = "MaxTotalBytesError";
    this.limit = limit;
    this.byteOffset = byteOffset;
  }
}

// Containers a local `$ref` may target. Carried onto a delegated island
// subschema so internal refs (`#/$defs/...`, `#/components/schemas/...`,
// draft-07 `#/definitions/...`) resolve against the in-memory compile.
const REF_CONTAINERS = ["$defs", "definitions", "components"] as const;

type CompiledValidator = (
  data: unknown,
  startPath?: readonly PathSegment[],
) => { valid: true } | { valid: false; errors: ValidationError[] };

// Map an in-memory ValidationError to a SchemaViolation, stamping the
// island's stream byte offset onto every node (the materialized subtree
// shares one offset; children have no offset of their own).
function violationFromError(e: ValidationError, byteOffset: number): SchemaViolation {
  return {
    code: e.code,
    path: e.path,
    byteOffset,
    message: e.message,
    params: e.params,
    children: e.children.map((c) => violationFromError(c, byteOffset)),
  };
}

/**
 * Build the island delegate: validate a materialized subtree against the
 * in-memory engine, compiling each schema node once and caching it. Local
 * `$ref`s are resolved by attaching the document root's ref-holder
 * containers (`$defs` / `definitions` / `components`) to the compiled
 * subschema, so `#/$defs/...`, `#/components/schemas/...`, etc. resolve.
 * (A self-`#` ref inside an island still resolves to the island, not the
 * original document root: the documented edge case.)
 */
function buildDelegate(
  root: SchemaOrBoolean,
  dialect: Dialect,
  options: StreamValidatorOptions,
): IslandDelegate {
  const rootObj =
    typeof root === "object" && root !== null && !Array.isArray(root)
      ? (root as SchemaObject as Record<string, unknown>)
      : undefined;
  const cache = new Map<SchemaObject, CompiledValidator>();

  const compile = (schema: SchemaObject): CompiledValidator => {
    let v = cache.get(schema);
    if (v === undefined) {
      const doc: Record<string, unknown> = { ...schema };
      if (rootObj !== undefined) {
        for (const c of REF_CONTAINERS) {
          const rootC = rootObj[c];
          if (rootC === undefined) continue;
          // `#/$defs/...` (etc.) in an island target the DOCUMENT root's
          // container, not a node-local one, so the root's entries win on a
          // name collision; any extra node-local entries are kept (harmless,
          // unreachable via a root-relative pointer).
          const local = doc[c];
          doc[c] =
            local !== null && typeof local === "object"
              ? { ...(local as Record<string, unknown>), ...(rootC as Record<string, unknown>) }
              : rootC;
        }
      }
      v = compileSchema(doc as never, {
        dialect,
        maxErrors: Number.POSITIVE_INFINITY,
        // Bound the in-memory delegate's native recursion so a deeply
        // nested island fails as a client error, not a RangeError crash.
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.formats === undefined ? {} : { formats: options.formats }),
        ...(options.regexCompiler === undefined ? {} : { regexCompiler: options.regexCompiler }),
        ...(options.keywords === undefined ? {} : { keywords: options.keywords }),
      }).validate as CompiledValidator;
      cache.set(schema, v);
    }
    return v;
  };

  return (schemas, value, startPath, byteOffset) => {
    const out: SchemaViolation[] = [];
    for (const schema of schemas) {
      const result = compile(schema)(value, startPath);
      if (!result.valid) {
        for (const e of result.errors) out.push(violationFromError(e, byteOffset));
      }
    }
    return out;
  };
}

// Reject a numeric option that would silently misconfigure the run (0,
// negative, or a non-integer). `Infinity` is the explicit "uncapped"
// value and is accepted. Mirrors compileSchema / createValidator so a
// migration sees the same contract. Throws at construction, not mid-stream.
function assertPositiveIntOption(name: string, value: number | undefined, hint: string): void {
  if (value !== undefined && Number.isFinite(value) && (!Number.isInteger(value) || value < 1)) {
    throw new Error(
      `createStreamValidator: \`${name}\` must be a positive integer (got ${String(value)}). ${hint}`,
    );
  }
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
  private readonly valueEvents: StreamValidatorOptions["valueEvents"];
  // Capture mode: the spine applies the value-event filter (to gate text
  // retention) and gates emission on it, so the driver trusts the spine
  // and does not re-run the filter. Span-only: the spine emits every
  // scalar and the driver filters here.
  private readonly valueCaptureConfigured: boolean;

  private readonly maxTotalBytes: number | undefined;
  private totalBytes = 0;
  private errorCount = 0;
  private sealed = false; // detach: validation stopped, echo-only tail
  private finished = false; // verdict settled

  // Edit hooks, in registration order; and the byte injections a chunk's
  // scope closes produced (consumed by the injection-aware echo).
  private readonly scopeHooks: Array<
    { at: PathFilter; observe: ScopeObserver } | { at: PathFilter; edit: ScopeEditor }
  > = [];
  private pendingInjections: Array<{ offset: number; bytes: Buffer }> = [];

  /** Resolves with the final verdict (rejects on a fatal parse / I/O error). */
  readonly result: Promise<StreamVerdict>;
  private resolveResult!: (v: StreamVerdict) => void;
  private rejectResult!: (err: Error) => void;

  constructor(schema: SchemaOrBoolean, options: StreamValidatorOptions = {}) {
    super();
    assertPositiveIntOption(
      "maxErrors",
      options.maxErrors,
      "Omit the option for fast-fail (1), or pass `Number.POSITIVE_INFINITY` to collect every violation.",
    );
    assertPositiveIntOption(
      "maxDepth",
      options.maxDepth,
      "Omit the option for uncapped recursion depth.",
    );
    assertPositiveIntOption(
      "maxBufferedBytes",
      options.maxBufferedBytes,
      "Omit the option for no buffered-island cap.",
    );
    assertPositiveIntOption(
      "maxTotalBytes",
      options.maxTotalBytes,
      "Omit the option for no total-size cap.",
    );
    if (typeof options.valueEvents === "object") {
      assertPositiveIntOption(
        "valueEvents.maxCaptureBytes",
        options.valueEvents.maxCaptureBytes,
        "Omit it to use the default capture cap.",
      );
    }
    this.maxErrors = options.maxErrors ?? 1;
    this.policy = options.policy ?? "terminate";
    this.maxTotalBytes = options.maxTotalBytes;
    const keyEvents = options.keyEvents;
    const valueEvents = options.valueEvents;
    this.valueEvents = valueEvents;
    // When capture is on, the matched members retain their decoded scalar
    // (bounded by the cap); an offsets-only subscription leaves this unset
    // and the spine buffers nothing. Hoisted so the closures below keep a
    // narrowed type.
    const captureFilter =
      typeof valueEvents === "object" && valueEvents.capture ? valueEvents.at : undefined;
    this.valueCaptureConfigured = captureFilter !== undefined;
    const captureCap =
      typeof valueEvents === "object" && valueEvents.maxCaptureBytes !== undefined
        ? valueEvents.maxCaptureBytes
        : DEFAULT_MAX_CAPTURE_BYTES;

    // OpenAPI 3.0 -> 2020-12 normalization (nullable / boolean exclusive*
    // / $ref sibling suppression) before any classification. 3.1 / 3.2
    // are 2020-12-native. Both select the OpenAPI dialect (format
    // asserts); raw JSON Schema uses jsonSchemaDialect.
    const root = options.openApiVersion === "3.0" ? normalizeOas30(schema) : schema;
    const dialect =
      options.dialect ??
      (options.openApiVersion !== undefined ? openapi31Dialect : jsonSchemaDialect);

    // Compile-time fast-fail (invariant 2): classify before any byte. A
    // REJECT keyword (`unevaluated*`), an unknown keyword, or an
    // unresolvable `$ref` throws here, naming the keyword + path.
    const classification = classify(root, {
      dialect,
      customKeywords: options.keywords === undefined ? undefined : Object.keys(options.keywords),
      parity: options.parity,
      enforceBounds: options.enforceBounds,
    });
    // Surface the sound-but-unbounded warnings the classifier flagged
    // (enforceBounds turns them into a throw above; otherwise they are dropped
    // unless a `warn` sink is provided).
    if (options.warn !== undefined) {
      for (const w of classification.warnings) options.warn(w.message);
    }

    this.spine = new SpineValidator(root, {
      onViolation: (v) => this.handleViolation(v),
      strategyOf: classification.strategyOf,
      delegate: buildDelegate(root, dialect, options),
      maxErrors: this.maxErrors,
      // OpenAPI dialects assert `format`; the spine has no format check
      // of its own, so format-bearing scalars delegate under those.
      assertsFormat: dialect.vocabularies.some((v) => v.uri === FORMAT_ASSERTION_VOCAB),
      ...(options.maxBufferedBytes === undefined
        ? {}
        : { maxBufferedBytes: options.maxBufferedBytes }),
      ...(options.maxUniqueItems === undefined ? {} : { maxUniqueItems: options.maxUniqueItems }),
      ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
      ...(options.regexCompiler === undefined ? {} : { regexCompiler: options.regexCompiler }),
      ...(keyEvents
        ? {
            keyEvent: (scopePath: readonly PathSegment[], key: string, byteOffset: number) => {
              if (keyEvents === true || matchPathFilter(keyEvents.at, scopePath, "object")) {
                this.emit("key", { path: [...scopePath], key, byteOffset });
              }
            },
          }
        : {}),
      ...(valueEvents
        ? {
            valueEvent: (
              scopePath: readonly PathSegment[],
              key: string,
              valueStart: number,
              valueEnd: number,
              type: "string" | "number" | "boolean" | "null",
              value: string | number | boolean | null | undefined,
              truncated: boolean,
            ) => {
              this.handleValueEvent(scopePath, key, valueStart, valueEnd, type, value, truncated);
            },
            // Capture (retaining the decoded scalar) is gated to the
            // matched members so a huge unmatched value never buffers.
            ...(captureFilter !== undefined
              ? {
                  shouldCapture: (scopePath: readonly PathSegment[], key: string) =>
                    matchValueFilter(captureFilter, scopePath, key),
                  maxCaptureBytes: captureCap,
                }
              : {}),
          }
        : {}),
      onScopeClose: (close: ScopeClose) => this.handleScopeClose(close),
    });
    this.tokenizer = new JsonTokenizer(this.spine);
    this.result = new Promise<StreamVerdict>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // A caller may never await `result` (they may rely on `pipeline`
    // rejecting instead). Mark it handled so a rejection here is not an
    // unhandled-rejection warning; explicit awaiters still observe it.
    this.result.catch(() => {});
  }

  private handleViolation(violation: SchemaViolation): void {
    this.errorCount += 1;
    this.emit("violation", violation);
  }

  // Emit a `value` event for a scalar member the spine reported. Where the
  // path filter runs depends on the mode (see below): span-only mode
  // filters here, mirroring how `keyEvent` filters in the driver; capture
  // mode filters in the spine.
  private handleValueEvent(
    scopePath: readonly PathSegment[],
    key: string,
    valueStart: number,
    valueEnd: number,
    type: "string" | "number" | "boolean" | "null",
    value: string | number | boolean | null | undefined,
    truncated: boolean,
  ): void {
    const ve = this.valueEvents;
    if (ve === undefined || ve === false) return;
    // Capture mode: the spine already applied the (identical) filter and
    // only emits matched members, so re-filtering here would run the
    // predicate twice per value. Span-only mode filters here.
    if (!this.valueCaptureConfigured && ve !== true && !matchValueFilter(ve.at, scopePath, key)) {
      return;
    }
    // `path` is the value's full path (enclosing scope plus key), the same
    // coordinate `valueEvents.at` matches, so a caller can filter and read
    // the event in one coordinate system. `key` is the trailing segment,
    // kept as a convenience.
    const event: ValueEvent = {
      path: [...scopePath, key],
      key,
      valueStart,
      valueEnd,
      type,
      truncated,
    };
    if (value !== undefined) event.value = value;
    this.emit("value", event);
  }

  /**
   * Observe a forward-decidable (STREAM) scope at its close, after its
   * verdict is known. Register before piping. Islands (composition /
   * buffered scopes) are not reported.
   */
  onScopeClose(at: PathFilter, observe: ScopeObserver): void {
    this.scopeHooks.push({ at, observe });
  }

  /**
   * Append bytes before a forward-decidable scope's closing delimiter
   * (append-only; the appended bytes are not validated). Register before
   * piping. Return `null` for a no-op.
   */
  editClose(at: PathFilter, edit: ScopeEditor): void {
    this.scopeHooks.push({ at, edit });
  }

  private handleScopeClose(close: ScopeClose): void {
    if (this.scopeHooks.length === 0) return;
    const ctx = makeScopeContext(close.path, close.kind, close.valid, close.memberCount);
    const parts: Buffer[] = [];
    for (const h of this.scopeHooks) {
      if (!matchPathFilter(h.at, close.path, close.kind)) continue;
      if ("observe" in h) h.observe(ctx);
      else {
        const b = h.edit(ctx);
        if (b !== null) parts.push(toBuffer(b));
      }
    }
    if (parts.length > 0) {
      this.pendingInjections.push({ offset: close.delimiterOffset, bytes: Buffer.concat(parts) });
    }
  }

  // Echo a chunk, splicing each scope-close injection in before its
  // delimiter byte. Injections arrive in ascending offset order (scopes
  // close child-before-parent).
  private emitWithInjections(chunk: Buffer, base: number): void {
    let local = 0;
    for (const inj of this.pendingInjections) {
      const cut = inj.offset - base;
      if (cut < local || cut > chunk.length) continue;
      if (cut > local) this.push(chunk.subarray(local, cut));
      this.push(inj.bytes);
      local = cut;
    }
    if (local < chunk.length) this.push(chunk.subarray(local));
    this.pendingInjections = [];
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.sealed || this.finished) {
      this.push(chunk); // echo the detach tail / post-settle bytes verbatim
      cb();
      return;
    }
    const base = this.totalBytes;
    this.totalBytes += chunk.length;
    // Refuse oversize input regardless of validity (policy lever).
    if (this.maxTotalBytes !== undefined && this.totalBytes > this.maxTotalBytes) {
      this.push(chunk);
      const err = new MaxTotalBytesError(this.maxTotalBytes, this.totalBytes);
      this.finished = true;
      this.rejectResult(err);
      cb(err);
      return;
    }

    // With edit hooks, tokenize first (collecting injections), then echo
    // with the injections spliced in. Without hooks, echo verbatim up
    // front (the fast path).
    if (this.scopeHooks.length > 0) {
      this.pendingInjections = [];
      let err: unknown;
      try {
        this.tokenizer.write(chunk);
      } catch (e) {
        err = e;
      }
      this.emitWithInjections(chunk, base);
      if (err === undefined) {
        cb();
      } else if (err instanceof BudgetReached) {
        this.applyBudget(cb);
      } else {
        this.finished = true;
        this.rejectResult(err as Error);
        cb(err as Error);
      }
      return;
    }

    // Echo first: output is the verbatim input byte stream (invariant 1).
    this.push(chunk);
    try {
      this.tokenizer.write(chunk);
    } catch (err) {
      if (err instanceof BudgetReached) {
        // The budget was hit mid-chunk: apply the terminal policy.
        this.applyBudget(cb);
        return;
      }
      // Fatal: a parse error or a buffer-limit overflow. Destroys the
      // stream, emits 'error', and rejects the result promise.
      this.finished = true;
      this.rejectResult(err as Error);
      cb(err as Error);
      return;
    }
    cb();
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
        // BudgetReached at close just finalizes (below); other throws are fatal.
        if (!(err instanceof BudgetReached)) {
          this.finished = true;
          this.rejectResult(err as Error);
          cb(err as Error);
          return;
        }
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

  // Cleanup on every exit path, including consumer abort (the most
  // leaked). Settle the result so an awaiter never hangs; engine state is
  // heap-only and reclaimed once this instance is unreferenced.
  override _destroy(err: Error | null, cb: (error: Error | null) => void): void {
    if (!this.finished) {
      this.finished = true;
      this.rejectResult(err ?? new Error("stream-validator: destroyed before completion"));
    }
    cb(err);
  }
}

/**
 * Create a {@link StreamValidator} for `schema`. Throws at construction
 * (before any byte) if the schema cannot be soundly streamed.
 *
 * Validates one complete JSON document as it streams. Per-record
 * validation of a sequence (NDJSON / json-seq under an OpenAPI 3.2
 * `itemSchema`) is a distinct lifecycle (N item verdicts plus an
 * aggregate, gate vs pass-through emission, a per-record byte ceiling)
 * and will arrive as a sibling factory, not a mode of this one. This
 * factory's contract stays single-document.
 *
 * @public
 */
export function createStreamValidator(
  schema: SchemaOrBoolean,
  options?: StreamValidatorOptions,
): StreamValidator {
  return new StreamValidator(schema, options);
}
