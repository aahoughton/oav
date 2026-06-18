/**
 * The forward validation spine: a {@link JsonEventHandler} that validates
 * a streaming JSON value against a resolved schema in one pass, carrying
 * scope on an explicit heap stack, and produces a verdict.
 *
 * A scope holds the AND-list of schemas its value must satisfy
 * (structural applicator overlap plus `$ref` expansion all combine as
 * "must satisfy every one"); `$ref` is followed by expansion, so deep
 * recursion grows the heap scope stack, never the native call stack.
 *
 * A value is handled by one of three strategies:
 *
 *   - **STREAM**: validated on the forward state machines in one pass.
 *   - **TEE**: forward composition (`allOf` / `anyOf` / `oneOf` / `not` /
 *     `if`, all branches forward). The value's events are fanned out to
 *     one forward sub-spine per branch (no materialization) and the
 *     combinators are evaluated at scope-close; this is what keeps a
 *     composition body streaming.
 *   - **BUFFER island**: anything that needs the whole value (object/array
 *     `enum` / `const`, `dependentSchemas`, `discriminator`, `contains`,
 *     `uniqueItems`, a composition with a non-forward branch, or `format`
 *     under an asserting dialect). The value is materialized via
 *     {@link ValueBuilder} and handed to the injected
 *     {@link IslandDelegate} (the in-memory engine).
 *
 * BUFFER dominates TEE (a value needing both materializes). With no
 * delegate wired (a bare spine), a BUFFER value throws
 * {@link SpineUnsupportedError}; forward composition still TEEs.
 * `maxBufferedBytes` caps a single island (and forced-buffer scalar);
 * `maxDepth` records a `depth` violation.
 *
 * @packageDocumentation
 */

import type { PathSegment, SchemaObject, SchemaOrBoolean } from "@oav/core";
import type { RegexCompiler } from "@oav/schema";
import type { Strategy } from "../classifier/strategy.js";
import type { JsonEventHandler } from "../tokenizer/index.js";
import { resolveRef } from "../ref-resolve.js";
import { ValueBuilder } from "./value-builder.js";

/** A construct the spine cannot handle without a delegate (no classification wired). */
export class SpineUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpineUnsupportedError";
  }
}

/**
 * Internal control-flow signal: the validation budget (`maxErrors`) has
 * been reached, so the spine stops feeding the tokenizer. The engine
 * catches it and applies the terminal policy; it is not a parse error.
 */
export class BudgetReached extends Error {
  constructor() {
    super("validation budget reached");
    this.name = "BudgetReached";
  }
}

/** A buffered island exceeded the configured `maxBufferedBytes`. Fatal. */
export class BufferLimitError extends Error {
  readonly byteOffset: number;
  constructor(limit: number, byteOffset: number) {
    super(`buffered island exceeded maxBufferedBytes=${limit} (at byte ${byteOffset})`);
    this.name = "BufferLimitError";
    this.byteOffset = byteOffset;
  }
}

/** Validates a materialized island value against schemas; returns flat violations. */
export type IslandDelegate = (
  schemas: SchemaObject[],
  value: unknown,
  startPath: PathSegment[],
  byteOffset: number,
) => SchemaViolation[];

/**
 * A non-fatal schema violation: a well-formed value that failed the
 * schema, reported on the `violation` side channel (distinct from the
 * fatal `error` channel). Shares `code` and `path` with `@oav/core`'s
 * `ValidationError` and adds `byteOffset`.
 *
 * `message` / `params` / `children` are populated on the BUFFER (island)
 * path, where the in-memory engine produces them; on the forward STREAM
 * path they are absent (a leaf violation carries `code` + `path` +
 * `byteOffset`). They are optional so a future stream-path enrichment
 * lands additively. Codes are coarse for now; the channel layer refines
 * them.
 */
export interface SchemaViolation {
  code: string;
  path: PathSegment[];
  /**
   * Byte offset in the input stream nearest the violation (for re-sync).
   * On the BUFFER path every node of one island (a violation and its
   * `children`) shares the island's start offset; per-child precision is
   * not tracked.
   */
  byteOffset: number;
  /** Human-readable message (BUFFER path only; absent on the STREAM path). */
  message?: string;
  /** Keyword-specific machine-readable detail (BUFFER path only). */
  params?: Record<string, unknown>;
  /** Child violations, e.g. per-branch composition failures (BUFFER path only). */
  children?: SchemaViolation[];
}

/** Options for {@link SpineValidator}. */
export interface SpineOptions {
  /** Called as each violation is recorded (lets a driver enforce a budget / terminate). */
  onViolation?: (violation: SchemaViolation) => void;
  /** Per-node strategy from the classifier. Absent: every node is treated as `stream`. */
  strategyOf?: (node: SchemaOrBoolean) => Strategy;
  /**
   * Document root for `$ref` resolution, when it differs from the
   * validation root (a TEE sub-spine validates a branch but resolves refs
   * against the whole document). Defaults to the validation root.
   */
  refRoot?: SchemaOrBoolean;
  /**
   * Validates a materialized BUFFER island against its schemas (the
   * in-memory engine). Required for any non-stream node; absent, such a
   * node throws {@link SpineUnsupportedError}.
   */
  delegate?: IslandDelegate;
  /** Stop recording after this many violations, throwing {@link BudgetReached}. Default unlimited. */
  maxErrors?: number;
  /**
   * Track only a boolean verdict, not the violation list (used by TEE
   * branch sub-spines, which the parent reads as valid/invalid). Keeps a
   * branch over a large value O(1) in memory. Default false.
   */
  verdictOnly?: boolean;
  /** Cap on a single buffered island's UTF-8 source-byte span (and forced-buffer scalar). Unset: no cap. */
  maxBufferedBytes?: number;
  /** Maximum nesting depth. Exceeding it is a `depth` violation. Unset: no cap. */
  maxDepth?: number;
  /** Regex engine for `pattern` (e.g. RE2). Hardens the spine's own regex use. */
  regexCompiler?: RegexCompiler;
  /**
   * The active dialect asserts `format` (OpenAPI). When true, a schema
   * carrying `format` is delegated so the in-memory engine asserts it
   * (the spine has no format assertion of its own).
   */
  assertsFormat?: boolean;
  /**
   * Observability hook fired for every object key, with the enclosing
   * scope's path. Set only when key events are requested (so the spine
   * pays nothing when they are off); the driver applies any path filter.
   */
  keyEvent?: (scopePath: readonly PathSegment[], key: string, byteOffset: number) => void;
  /**
   * Fired when a forward-decidable (STREAM) object/array scope closes,
   * after its verdict is known and before its delimiter, for edit hooks.
   * Islands (composition / buffered scopes) are not reported: their
   * verdict is not final at the streaming close.
   */
  onScopeClose?: (close: ScopeClose) => void;
}

/** The verdict of a streaming validation. */
export interface StreamVerdict {
  valid: boolean;
  violations: SchemaViolation[];
}

type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

interface Applicable {
  schemas: SchemaObject[];
  hasFalse: boolean;
}

interface ObjectFrame {
  kind: "object";
  schemas: SchemaObject[];
  seen: Set<string>;
  count: number;
  pendingKey: string | null;
  violationsAtOpen: number;
}

interface ArrayFrame {
  kind: "array";
  schemas: SchemaObject[];
  count: number;
  violationsAtOpen: number;
}

// The combinator obligations a TEE value must satisfy. Each sub-spine
// validates the same value against one branch; verdicts are read at close.
interface TeeObligations {
  required: SpineValidator[]; // all must be valid (own keywords + allOf)
  anyOf: SpineValidator[][]; // each group: >= 1 valid
  oneOf: SpineValidator[][]; // each group: exactly 1 valid
  not: SpineValidator[]; // each must be INVALID
  ite: Array<{
    ifSub: SpineValidator;
    thenSub: SpineValidator | null;
    elseSub: SpineValidator | null;
  }>;
  hasFalse: boolean;
}

/** A forward-decidable (STREAM) scope closing, reported for edit hooks. */
export interface ScopeClose {
  path: PathSegment[];
  kind: "object" | "array";
  valid: boolean;
  memberCount: number;
  /** Byte offset of the closing delimiter (`}` / `]`). */
  delimiterOffset: number;
}

type Frame = ObjectFrame | ArrayFrame;

function isObjectSchema(s: unknown): s is SchemaObject {
  return typeof s === "object" && s !== null && !Array.isArray(s);
}

function typeMatches(declared: string | string[], actual: JsonType): boolean {
  const allow = Array.isArray(declared) ? declared : [declared];
  for (const t of allow) {
    if (t === actual) return true;
    if (t === "number" && actual === "integer") return true;
  }
  return false;
}

const STREAM_COMPOSITION = ["allOf", "anyOf", "oneOf", "not", "if"];

/**
 * Validates a streaming JSON value against `root`, emitting violations
 * and a final verdict. Drive it by feeding tokenizer events; read the
 * verdict with {@link SpineValidator.verdict} after `end`.
 *
 * @public
 */
export class SpineValidator implements JsonEventHandler {
  private readonly root: SchemaOrBoolean;
  private readonly refRoot: SchemaObject;
  private readonly violations: SchemaViolation[] = [];
  private readonly path: PathSegment[] = [];
  private readonly frames: Frame[] = [];
  private readonly regexCache = new Map<string, { test(s: string): boolean }>();
  // Memoized `$ref` / `$dynamicRef` resolution against the fixed `refRoot`.
  // `expand` runs per value, so without this an anchor ref (`#name`) would
  // re-scan the whole document via `walkSubschemas` on every occurrence
  // (O(N*M) across a large array or broad object). Keyed by ref string,
  // which is stable because `refRoot` is immutable for the spine's life;
  // `undefined` (a dangling/external ref) is cached too via `has`.
  private readonly refCache = new Map<string, SchemaOrBoolean | undefined>();
  // Memoized per-node stream/tee/buffer decision (see nodeKind).
  private readonly kindCache = new Map<SchemaObject, "stream" | "tee" | "buffer">();
  private readonly onViolation: ((violation: SchemaViolation) => void) | undefined;
  private readonly strategyOf: (node: SchemaOrBoolean) => Strategy;
  private readonly delegate: IslandDelegate | undefined;
  private readonly maxErrors: number;
  private readonly maxBufferedBytes: number | undefined;
  private readonly maxDepth: number | undefined;
  private readonly regexCompiler: RegexCompiler | undefined;
  private readonly assertsFormat: boolean;
  private readonly keyEvent:
    | ((scopePath: readonly PathSegment[], key: string, byteOffset: number) => void)
    | undefined;
  private readonly onScopeClose: ((close: ScopeClose) => void) | undefined;
  // Verdict-only mode (TEE branch sub-spines): track a single invalid flag
  // instead of retaining a violation per failure, so a branch over a huge
  // array stays O(1) memory. The parent only reads `verdict().valid`.
  private readonly verdictOnly: boolean;
  private invalid = false;
  private depthReported = false;

  // Byte offset of the event currently being validated; stamped onto
  // violations so a consumer can re-sync against the byte stream.
  private curOffset = 0;

  // A value string in progress: its applicable schemas, whether the full
  // text is needed (pattern / enum / const, or an island), the accumulated
  // text, and whether the string position is a BUFFER island.
  private str: {
    app: Applicable;
    needText: boolean;
    text: string;
    offset: number;
    island: boolean;
  } | null = null;

  // An open BUFFER island being materialized for delegation.
  private island: {
    schemas: SchemaObject[];
    path: PathSegment[];
    builder: ValueBuilder;
    byteStart: number;
  } | null = null;

  // An open TEE: the value's events are forwarded to one forward sub-spine
  // per composition branch (no materialization); combined at scope-close.
  private tee: {
    obligations: TeeObligations;
    subs: SpineValidator[]; // flat list, for event forwarding
    depth: number;
    inString: boolean;
    started: boolean;
  } | null = null;

  constructor(root: SchemaOrBoolean, options: SpineOptions = {}) {
    this.root = root;
    const ref = options.refRoot ?? root;
    this.refRoot = isObjectSchema(ref) ? ref : ({} as SchemaObject);
    this.onViolation = options.onViolation;
    this.strategyOf = options.strategyOf ?? (() => "stream");
    this.delegate = options.delegate;
    this.maxErrors = options.maxErrors ?? Number.POSITIVE_INFINITY;
    this.verdictOnly = options.verdictOnly ?? false;
    this.maxBufferedBytes = options.maxBufferedBytes;
    this.maxDepth = options.maxDepth;
    this.regexCompiler = options.regexCompiler;
    this.assertsFormat = options.assertsFormat ?? false;
    this.keyEvent = options.keyEvent;
    this.onScopeClose = options.onScopeClose;
  }

  /** The verdict so far (final once `end` has been called on the tokenizer). */
  verdict(): StreamVerdict {
    if (this.verdictOnly) return { valid: !this.invalid, violations: this.violations };
    return { valid: this.violations.length === 0, violations: this.violations };
  }

  private fail(code: string, path: PathSegment[] = this.path): void {
    this.record({ code, path: [...path], byteOffset: this.curOffset });
  }

  // Record a violation and enforce the budget. Once `maxErrors` is
  // reached, throw {@link BudgetReached} so the spine stops feeding the
  // tokenizer (the verdict carries exactly `maxErrors` violations, and no
  // further work runs this chunk).
  private record(violation: SchemaViolation): void {
    if (this.verdictOnly) {
      // A TEE branch: an invalid result is data the combinator needs, not
      // a parent violation. Flag and keep going (no retention, no throw).
      this.invalid = true;
      return;
    }
    this.violations.push(violation);
    this.onViolation?.(violation);
    if (this.violations.length >= this.maxErrors) throw new BudgetReached();
  }

  private regex(pattern: string): { test(s: string): boolean } {
    let re = this.regexCache.get(pattern);
    if (re === undefined) {
      // Route through the hardening compiler (e.g. RE2) when provided;
      // the spine's regex runs against attacker-controlled input bytes.
      re =
        this.regexCompiler !== undefined ? this.regexCompiler(pattern) : new RegExp(pattern, "u");
      this.regexCache.set(pattern, re);
    }
    return re;
  }

  // Expand a schema into the object schemas whose own keywords apply,
  // following `$ref` and `$dynamicRef`. A `false` sets hasFalse; a `true`
  // contributes nothing.
  //
  // The `seen` cycle guard is allocated lazily, only when a `$ref` is
  // actually followed: a ref-free schema (the hot path) expands without
  // allocating a Set at all.
  private expand(s: SchemaOrBoolean | undefined, out: Applicable, seen?: Set<object>): void {
    if (s === undefined || s === true) return;
    if (s === false) {
      out.hasFalse = true;
      return;
    }
    if (!isObjectSchema(s)) return;
    out.schemas.push(s);
    // `$dynamicRef` is resolved statically against the anchor map, the
    // same limitation @oav/schema documents. Refs resolve against the
    // document root (may differ from the validation root in a sub-spine).
    const ref = (s as Record<string, unknown>).$ref ?? (s as Record<string, unknown>).$dynamicRef;
    if (typeof ref !== "string") return;
    let target: SchemaOrBoolean | undefined;
    if (this.refCache.has(ref)) {
      target = this.refCache.get(ref);
    } else {
      target = resolveRef(this.refRoot, ref);
      this.refCache.set(ref, target);
    }
    if (target === undefined) return;
    if (!isObjectSchema(target)) {
      this.expand(target, out, seen); // boolean target
      return;
    }
    if (seen?.has(target)) return; // cycle
    const guard = seen ?? new Set<object>();
    guard.add(target);
    this.expand(target, out, guard);
  }

  // The AND-list of schemas the value about to be parsed must satisfy.
  private schemasForValue(): Applicable {
    const out: Applicable = { schemas: [], hasFalse: false };
    const top = this.frames[this.frames.length - 1];
    if (top === undefined) {
      this.expand(this.root, out);
    } else if (top.kind === "object") {
      for (const s of top.schemas) this.collectObjectValue(s, top.pendingKey as string, out);
    } else {
      for (const s of top.schemas) this.collectArrayElement(s, top.count, out);
    }
    return out;
  }

  private collectObjectValue(s: SchemaObject, key: string, out: Applicable): void {
    let matched = false;
    if (s.properties !== undefined && Object.hasOwn(s.properties, key)) {
      this.expand(s.properties[key], out);
      matched = true;
    }
    if (s.patternProperties !== undefined) {
      for (const pat of Object.keys(s.patternProperties)) {
        if (this.regex(pat).test(key)) {
          this.expand(s.patternProperties[pat], out);
          matched = true;
        }
      }
    }
    if (!matched && s.additionalProperties !== undefined) {
      this.expand(s.additionalProperties, out);
    }
  }

  private collectArrayElement(s: SchemaObject, index: number, out: Applicable): void {
    if (s.prefixItems !== undefined && index < s.prefixItems.length) {
      this.expand(s.prefixItems[index], out);
    } else if (s.items !== undefined) {
      this.expand(s.items, out);
    }
  }

  // Whether a single schema must be materialized + delegated (BUFFER): a
  // keyword the spine cannot stream forward. Composition is NOT here (it
  // is handled by TEE unless a branch itself buffers, which the classifier
  // folds into `strategyOf === "buffer"`).
  // The handling a single schema node needs, memoized per node. Computing
  // it touches a dozen `key in schemaObject` checks across objects of
  // varying shape (megamorphic, and the dominant cost in profiling); the
  // same node validates every element of an array, so caching collapses
  // that to one Map lookup per value. The result is stable per node (it
  // depends only on the node's keywords, `strategyOf`, and the fixed
  // `assertsFormat`).
  private nodeKind(s: SchemaObject): "stream" | "tee" | "buffer" {
    let k = this.kindCache.get(s);
    if (k !== undefined) return k;
    k = this.computeKind(s);
    this.kindCache.set(s, k);
    return k;
  }

  private computeKind(s: SchemaObject): "stream" | "tee" | "buffer" {
    // BUFFER: anything the spine cannot stream forward (composition with a
    // non-forward branch folds into strategyOf === "buffer").
    if (this.strategyOf(s) === "buffer") return "buffer";
    if ("contains" in s) return "buffer"; // forward streaming of contains is not implemented
    if ("dependentSchemas" in s || "discriminator" in s) return "buffer";
    if (this.assertsFormat && "format" in s) return "buffer"; // no spine-side format assertion
    if (s.uniqueItems === true) return "buffer"; // canonical hashing not streamed
    const complex = (v: unknown): boolean => typeof v === "object" && v !== null;
    if (Array.isArray(s.enum) && s.enum.some(complex)) return "buffer"; // object/array equality
    if ("const" in s && complex((s as { const?: unknown }).const)) return "buffer";
    // TEE: forward composition.
    for (const k of STREAM_COMPOSITION) if (k in s) return "tee";
    return "stream";
  }

  // BUFFER dominates TEE: if any applicable schema must materialize, the
  // whole value is an island; otherwise forward composition is TEE'd.
  private needsIsland(app: Applicable): boolean {
    return app.schemas.some((s) => this.nodeKind(s) === "buffer");
  }

  private needsTee(app: Applicable): boolean {
    let tee = false;
    for (const s of app.schemas) {
      const k = this.nodeKind(s);
      if (k === "buffer") return false; // island dominates
      if (k === "tee") tee = true;
    }
    return tee;
  }

  // No delegate wired (e.g. a bare spine without a classifier): such a
  // value cannot be validated. Surface it rather than mis-stream.
  private requireDelegate(): IslandDelegate {
    if (this.delegate === undefined) {
      throw new SpineUnsupportedError(
        "schema requires materialization but no in-memory delegate is configured",
      );
    }
    return this.delegate;
  }

  // Validate an already-materialized scalar / string value in-memory.
  private delegateScalar(app: Applicable, value: unknown): void {
    const delegate = this.requireDelegate();
    this.pushSegment();
    if (app.hasFalse) this.fail("false");
    for (const v of delegate(app.schemas, value, [...this.path], this.curOffset)) this.record(v);
    this.popSegment();
    this.advance();
  }

  // Open a BUFFER island for a container value: materialize it from the
  // events, then delegate at its close.
  private beginContainerIsland(app: Applicable): void {
    this.requireDelegate();
    this.pushSegment();
    if (app.hasFalse) this.fail("false");
    this.island = {
      schemas: app.schemas,
      path: [...this.path],
      builder: new ValueBuilder(),
      byteStart: this.curOffset,
    };
  }

  // Forward an event into the open island, enforcing the buffer cap, and
  // finalize when the island's value is complete.
  private forwardIsland(feed: (b: ValueBuilder) => void): void {
    const island = this.island as NonNullable<typeof this.island>;
    feed(island.builder);
    if (
      this.maxBufferedBytes !== undefined &&
      this.curOffset - island.byteStart > this.maxBufferedBytes
    ) {
      throw new BufferLimitError(this.maxBufferedBytes, this.curOffset);
    }
    if (island.builder.complete) this.finalizeIsland();
  }

  private finalizeIsland(): void {
    const island = this.island as NonNullable<typeof this.island>;
    const delegate = this.delegate as IslandDelegate;
    this.island = null;
    for (const v of delegate(island.schemas, island.builder.value, island.path, island.byteStart)) {
      this.record(v);
    }
    this.popSegment();
    this.advance();
  }

  // A sub-spine validating the same value against one composition branch.
  // It streams (forward), resolves refs against the document root, and
  // delegates / islands its own non-forward parts; it surfaces nothing
  // (its verdict is read at the TEE's close).
  private makeSub(branch: SchemaOrBoolean): SpineValidator {
    const opts: SpineOptions = {
      strategyOf: this.strategyOf,
      refRoot: this.refRoot,
      assertsFormat: this.assertsFormat,
      verdictOnly: true, // only the branch's boolean verdict is needed
    };
    if (this.delegate !== undefined) opts.delegate = this.delegate;
    if (this.maxBufferedBytes !== undefined) opts.maxBufferedBytes = this.maxBufferedBytes;
    if (this.maxDepth !== undefined) opts.maxDepth = this.maxDepth;
    if (this.regexCompiler !== undefined) opts.regexCompiler = this.regexCompiler;
    return new SpineValidator(branch, opts);
  }

  // Decompose the applicable schemas into combinator obligations, each
  // backed by a sub-spine. A schema's own (non-composition) keywords are a
  // required obligation alongside its `allOf` members.
  private beginTee(app: Applicable): void {
    const obligations: TeeObligations = {
      required: [],
      anyOf: [],
      oneOf: [],
      not: [],
      ite: [],
      hasFalse: app.hasFalse,
    };
    for (const s of app.schemas) {
      obligations.required.push(this.makeSub(stripComposition(s)));
      if (Array.isArray(s.allOf))
        for (const b of s.allOf) obligations.required.push(this.makeSub(b));
      if (Array.isArray(s.anyOf)) obligations.anyOf.push(s.anyOf.map((b) => this.makeSub(b)));
      if (Array.isArray(s.oneOf)) obligations.oneOf.push(s.oneOf.map((b) => this.makeSub(b)));
      if (s.not !== undefined) obligations.not.push(this.makeSub(s.not));
      if (s.if !== undefined) {
        obligations.ite.push({
          ifSub: this.makeSub(s.if),
          thenSub: s.then === undefined ? null : this.makeSub(s.then),
          elseSub: s.else === undefined ? null : this.makeSub(s.else),
        });
      }
    }
    const subs = [
      ...obligations.required,
      ...obligations.anyOf.flat(),
      ...obligations.oneOf.flat(),
      ...obligations.not,
      ...obligations.ite.flatMap((t) =>
        [t.ifSub, t.thenSub, t.elseSub].filter((x): x is SpineValidator => x !== null),
      ),
    ];
    this.pushSegment();
    this.tee = { obligations, subs, depth: 0, inString: false, started: false };
  }

  private teeFeed(feed: (s: SpineValidator) => void): void {
    for (const s of (this.tee as NonNullable<typeof this.tee>).subs) feed(s);
  }

  private teeComplete(): boolean {
    const t = this.tee as NonNullable<typeof this.tee>;
    return t.started && t.depth === 0 && !t.inString;
  }

  private finalizeTee(): void {
    const o = (this.tee as NonNullable<typeof this.tee>).obligations;
    this.tee = null;
    if (!combineTee(o)) this.fail("composition");
    this.popSegment();
    this.advance();
  }

  // A scalar value at a TEE position: feed the single event to every sub
  // and combine immediately.
  private teeScalar(app: Applicable, feed: (s: SpineValidator) => void): void {
    this.beginTee(app);
    this.teeFeed(feed);
    this.tee!.started = true;
    this.finalizeTee();
  }

  private pushSegment(): void {
    const top = this.frames[this.frames.length - 1];
    if (top === undefined) return; // root value: no segment
    this.path.push(top.kind === "object" ? (top.pendingKey as string) : top.count);
  }

  private popSegment(): void {
    if (this.frames.length > 0) this.path.pop();
  }

  // Record a `depth` violation (once) when a new container would exceed
  // maxDepth. The spine's scope stack is on the heap, so this caps the
  // verdict as a client error rather than guarding a native overflow
  // (that is the in-memory island delegate's `maxDepth`).
  private checkDepth(): void {
    if (this.maxDepth !== undefined && this.frames.length >= this.maxDepth && !this.depthReported) {
      this.fail("depth");
      this.depthReported = true;
    }
  }

  // After a complete value, advance the enclosing scope.
  private advance(): void {
    const top = this.frames[this.frames.length - 1];
    if (top === undefined) return;
    if (top.kind === "object") top.pendingKey = null;
    else top.count += 1;
  }

  private checkType(schemas: SchemaObject[], actual: JsonType): void {
    for (const s of schemas) {
      if (s.type !== undefined && !typeMatches(s.type, actual)) this.fail("type");
    }
  }

  // const / enum against an object or array value. A complex candidate
  // would have made the schema BUFFER (deep equality), so any const / enum
  // reaching the stream path has only scalar candidates - which a
  // container can never equal.
  private checkContainerEquality(schemas: SchemaObject[]): void {
    for (const s of schemas) {
      if ("const" in s) this.fail("const");
      else if (Array.isArray(s.enum)) this.fail("enum");
    }
  }

  private checkScalar(
    schemas: SchemaObject[],
    actual: JsonType,
    value: string | number | boolean | null,
    codePoints: number,
  ): void {
    for (const s of schemas) {
      if ("enum" in s && Array.isArray(s.enum) && !s.enum.some((e) => e === value))
        this.fail("enum");
      if ("const" in s && (s as { const?: unknown }).const !== value) this.fail("const");
      if (actual === "string") {
        const str = value as string;
        if (s.minLength !== undefined && codePoints < s.minLength) this.fail("minLength");
        if (s.maxLength !== undefined && codePoints > s.maxLength) this.fail("maxLength");
        if (s.pattern !== undefined && !this.regex(s.pattern).test(str)) this.fail("pattern");
      } else if (actual === "number" || actual === "integer") {
        const num = value as number;
        if (s.minimum !== undefined && num < s.minimum) this.fail("minimum");
        if (s.maximum !== undefined && num > s.maximum) this.fail("maximum");
        if (typeof s.exclusiveMinimum === "number" && num <= s.exclusiveMinimum)
          this.fail("exclusiveMinimum");
        if (typeof s.exclusiveMaximum === "number" && num >= s.exclusiveMaximum)
          this.fail("exclusiveMaximum");
        if (s.multipleOf !== undefined && !isMultipleOf(num, s.multipleOf)) this.fail("multipleOf");
      }
    }
  }

  // A scalar value (number / boolean / null, or a finished string).
  private scalar(
    actual: JsonType,
    value: string | number | boolean | null,
    codePoints: number,
    app: Applicable,
  ): void {
    if (this.needsIsland(app)) {
      this.delegateScalar(app, value);
      return;
    }
    this.pushSegment();
    if (app.hasFalse) this.fail("false");
    this.checkType(app.schemas, actual);
    this.checkScalar(app.schemas, actual, value, codePoints);
    this.popSegment();
    this.advance();
  }

  onStartObject(offset: number): void {
    this.curOffset = offset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onStartObject(offset));
      this.tee.depth += 1;
      this.tee.started = true;
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onStartObject());
      return;
    }
    const app = this.schemasForValue();
    if (this.needsIsland(app)) {
      this.beginContainerIsland(app);
      this.forwardIsland((b) => b.onStartObject());
      return;
    }
    if (this.needsTee(app)) {
      this.beginTee(app);
      this.teeFeed((s) => s.onStartObject(offset));
      this.tee!.depth = 1;
      this.tee!.started = true;
      return;
    }
    this.checkDepth();
    this.pushSegment();
    if (app.hasFalse) this.fail("false");
    this.checkType(app.schemas, "object");
    this.checkContainerEquality(app.schemas);
    this.frames.push({
      kind: "object",
      schemas: app.schemas,
      seen: new Set(),
      count: 0,
      pendingKey: null,
      violationsAtOpen: this.violations.length,
    });
  }

  onEndObject(offset: number): void {
    this.curOffset = offset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onEndObject(offset));
      this.tee.depth -= 1;
      if (this.teeComplete()) this.finalizeTee();
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onEndObject());
      return;
    }
    const frame = this.frames.pop() as ObjectFrame;
    for (const s of frame.schemas) {
      if (Array.isArray(s.required)) {
        for (const r of s.required) if (!frame.seen.has(r)) this.fail("required");
      }
      if (s.minProperties !== undefined && frame.count < s.minProperties)
        this.fail("minProperties");
      if (s.maxProperties !== undefined && frame.count > s.maxProperties)
        this.fail("maxProperties");
      const dep = s.dependentRequired;
      if (dep !== undefined) {
        for (const k of Object.keys(dep)) {
          if (frame.seen.has(k)) {
            for (const need of dep[k] as string[])
              if (!frame.seen.has(need)) this.fail("dependentRequired");
          }
        }
      }
      // draft-07 `dependencies`, array form (a property-presence
      // dependency, like dependentRequired). Schema-form entries make the
      // node BUFFER (handled by the island delegate), so only array
      // entries reach here.
      const deps = (s as Record<string, unknown>).dependencies;
      if (deps !== null && typeof deps === "object" && !Array.isArray(deps)) {
        for (const [k, entry] of Object.entries(deps as Record<string, unknown>)) {
          if (Array.isArray(entry) && frame.seen.has(k)) {
            for (const need of entry as string[])
              if (!frame.seen.has(need)) this.fail("dependencies");
          }
        }
      }
    }
    this.onScopeClose?.({
      path: [...this.path],
      kind: "object",
      valid: this.violations.length === frame.violationsAtOpen,
      memberCount: frame.count,
      delimiterOffset: offset,
    });
    this.popSegment();
    this.advance();
  }

  onStartArray(offset: number): void {
    this.curOffset = offset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onStartArray(offset));
      this.tee.depth += 1;
      this.tee.started = true;
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onStartArray());
      return;
    }
    const app = this.schemasForValue();
    if (this.needsIsland(app)) {
      this.beginContainerIsland(app);
      this.forwardIsland((b) => b.onStartArray());
      return;
    }
    if (this.needsTee(app)) {
      this.beginTee(app);
      this.teeFeed((s) => s.onStartArray(offset));
      this.tee!.depth = 1;
      this.tee!.started = true;
      return;
    }
    this.checkDepth();
    this.pushSegment();
    if (app.hasFalse) this.fail("false");
    this.checkType(app.schemas, "array");
    this.checkContainerEquality(app.schemas);
    this.frames.push({
      kind: "array",
      schemas: app.schemas,
      count: 0,
      violationsAtOpen: this.violations.length,
    });
  }

  onEndArray(offset: number): void {
    this.curOffset = offset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onEndArray(offset));
      this.tee.depth -= 1;
      if (this.teeComplete()) this.finalizeTee();
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onEndArray());
      return;
    }
    const frame = this.frames.pop() as ArrayFrame;
    for (const s of frame.schemas) {
      if (s.minItems !== undefined && frame.count < s.minItems) this.fail("minItems");
      if (s.maxItems !== undefined && frame.count > s.maxItems) this.fail("maxItems");
    }
    this.onScopeClose?.({
      path: [...this.path],
      kind: "array",
      valid: this.violations.length === frame.violationsAtOpen,
      memberCount: frame.count,
      delimiterOffset: offset,
    });
    this.popSegment();
    this.advance();
  }

  onKey(value: string, codePoints: number, startOffset: number): void {
    this.curOffset = startOffset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onKey(value, codePoints, startOffset));
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onKey(value));
      return;
    }
    this.keyEvent?.(this.path, value, startOffset);
    const top = this.frames[this.frames.length - 1] as ObjectFrame;
    for (const s of top.schemas) {
      if (s.propertyNames !== undefined) this.checkPropertyName(s.propertyNames, value, codePoints);
    }
    top.seen.add(value);
    top.count += 1;
    top.pendingKey = value;
  }

  // Validate a key against a `propertyNames` subschema. With a delegate
  // the key is validated in-memory (sound for any subschema: enum, const,
  // format, composition, $ref, ...). Without one (a bare spine) it falls
  // back to the forward string keywords only.
  private checkPropertyName(propertyNames: SchemaOrBoolean, key: string, codePoints: number): void {
    const app: Applicable = { schemas: [], hasFalse: false };
    this.expand(propertyNames, app);
    const keyPath = [...this.path, key];
    if (app.hasFalse) this.fail("propertyNames", keyPath);
    if (app.schemas.length === 0) return;
    if (this.delegate !== undefined) {
      for (const v of this.delegate(app.schemas, key, keyPath, this.curOffset)) this.record(v);
      return;
    }
    for (const ps of app.schemas) {
      if (ps.type !== undefined && !typeMatches(ps.type, "string"))
        this.fail("propertyNames", keyPath);
      if (ps.minLength !== undefined && codePoints < ps.minLength)
        this.fail("propertyNames", keyPath);
      if (ps.maxLength !== undefined && codePoints > ps.maxLength)
        this.fail("propertyNames", keyPath);
      if (ps.pattern !== undefined && !this.regex(ps.pattern).test(key))
        this.fail("propertyNames", keyPath);
    }
  }

  onStringStart(offset: number): void {
    this.curOffset = offset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onStringStart(offset));
      this.tee.inString = true;
      this.tee.started = true;
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onStringStart());
      return;
    }
    const app = this.schemasForValue();
    if (this.needsTee(app)) {
      this.beginTee(app);
      this.teeFeed((s) => s.onStringStart(offset));
      this.tee!.inString = true;
      this.tee!.started = true;
      this.str = null;
      return;
    }
    const island = this.needsIsland(app);
    // Buffer the text when a forward keyword needs it (pattern / enum /
    // const) or when the value is a BUFFER island (delegated whole).
    const needText =
      island || app.schemas.some((s) => s.pattern !== undefined || "enum" in s || "const" in s);
    this.str = { app, needText, text: "", offset, island };
  }

  onStringChunk(chunk: string, offset: number): void {
    this.curOffset = offset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onStringChunk(chunk, offset));
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onStringChunk(chunk));
      return;
    }
    if (this.str !== null && this.str.needText) {
      this.str.text += chunk;
      // A forced-buffer scalar (pattern / enum / const) accumulates; cap
      // its source-byte span so it can't grow unbounded on hostile input.
      if (this.maxBufferedBytes !== undefined && offset - this.str.offset > this.maxBufferedBytes) {
        throw new BufferLimitError(this.maxBufferedBytes, offset);
      }
    }
  }

  onStringEnd(codePoints: number, startOffset: number, endOffset: number): void {
    this.curOffset = endOffset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onStringEnd(codePoints, startOffset, endOffset));
      this.tee.inString = false;
      if (this.teeComplete()) this.finalizeTee();
      return;
    }
    if (this.island !== null) {
      // Enforce the cap on the full span (a large single-chunk island
      // string never triggered the per-chunk check).
      this.forwardIsland((b) => b.onStringEnd());
      return;
    }
    const s = this.str as {
      app: Applicable;
      needText: boolean;
      text: string;
      offset: number;
      island: boolean;
    };
    this.str = null;
    // Close the single-chunk bypass: cap the forced-buffer scalar on its
    // full source-byte span, known only now.
    if (
      s.needText &&
      this.maxBufferedBytes !== undefined &&
      endOffset - s.offset > this.maxBufferedBytes
    ) {
      throw new BufferLimitError(this.maxBufferedBytes, endOffset);
    }
    this.curOffset = s.offset;
    if (s.island) {
      this.delegateScalar(s.app, s.text);
      return;
    }
    this.scalar("string", s.needText ? s.text : "", codePoints, s.app);
  }

  onNumber(value: number, raw: string, startOffset: number): void {
    this.curOffset = startOffset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onNumber(value, raw, startOffset));
      this.tee.started = true;
      if (this.teeComplete()) this.finalizeTee();
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onNumber(value));
      return;
    }
    const app = this.schemasForValue();
    const type = Number.isInteger(value) ? "integer" : "number";
    if (this.needsTee(app)) {
      this.teeScalar(app, (s) => s.onNumber(value, raw, startOffset));
      return;
    }
    this.scalar(type, value, 0, app);
  }

  onBoolean(value: boolean, startOffset: number): void {
    this.curOffset = startOffset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onBoolean(value, startOffset));
      this.tee.started = true;
      if (this.teeComplete()) this.finalizeTee();
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onBoolean(value));
      return;
    }
    const app = this.schemasForValue();
    if (this.needsTee(app)) {
      this.teeScalar(app, (s) => s.onBoolean(value, startOffset));
      return;
    }
    this.scalar("boolean", value, 0, app);
  }

  onNull(startOffset: number): void {
    this.curOffset = startOffset;
    if (this.tee !== null) {
      this.teeFeed((s) => s.onNull(startOffset));
      this.tee.started = true;
      if (this.teeComplete()) this.finalizeTee();
      return;
    }
    if (this.island !== null) {
      this.forwardIsland((b) => b.onNull());
      return;
    }
    const app = this.schemasForValue();
    if (this.needsTee(app)) {
      this.teeScalar(app, (s) => s.onNull(startOffset));
      return;
    }
    this.scalar("null", null, 0, app);
  }
}

// A shallow copy of a schema with its composition keywords removed: the
// schema's own (non-composition) obligation for a TEE.
function stripComposition(s: SchemaObject): SchemaObject {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "allOf" || k === "anyOf" || k === "oneOf" || k === "not" || k === "if") continue;
    if (k === "then" || k === "else") continue; // partners of `if`
    out[k] = v;
  }
  return out as SchemaObject;
}

// Combine TEE sub-spine verdicts per the composition combinators.
function combineTee(o: TeeObligations): boolean {
  if (o.hasFalse) return false;
  for (const s of o.required) if (!s.verdict().valid) return false;
  // An empty anyOf / oneOf is vacuously valid (matches @oav/schema, which
  // emits no check for an empty composition array).
  for (const group of o.anyOf) {
    if (group.length > 0 && !group.some((s) => s.verdict().valid)) return false;
  }
  for (const group of o.oneOf) {
    if (group.length > 0 && group.filter((s) => s.verdict().valid).length !== 1) return false;
  }
  for (const s of o.not) if (s.verdict().valid) return false;
  for (const t of o.ite) {
    const ifValid = t.ifSub.verdict().valid;
    if (ifValid && t.thenSub !== null && !t.thenSub.verdict().valid) return false;
    if (!ifValid && t.elseSub !== null && !t.elseSub.verdict().valid) return false;
  }
  return true;
}

// Mirror @oav/schema's tolerant multipleOf check so verdicts agree on
// floating-point divisors (see packages/schema/src/keywords/number.ts).
function isMultipleOf(value: number, divisor: number): boolean {
  const q = value / divisor;
  const tol = 16 * Number.EPSILON * Math.max(1, Math.abs(q), Math.abs(divisor));
  return Math.abs(q - Math.round(q)) <= tol;
}
