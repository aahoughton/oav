/**
 * The forward validation spine: a {@link JsonEventHandler} that validates
 * a streaming JSON value against a resolved schema in one pass, carrying
 * scope on an explicit heap stack, and produces a verdict.
 *
 * This step covers the STREAM keyword set only (verdict, no echo, no
 * channels). A scope holds the AND-list of schemas its value must satisfy
 * (structural applicator overlap plus `$ref` expansion all combine as
 * "must satisfy every one"); `$ref` is followed by expansion, so deep
 * recursion grows the heap scope stack, never the native call stack.
 *
 * Constructs outside the STREAM set throw {@link SpineUnsupportedError}
 * rather than producing a wrong verdict: explicit composition
 * (`allOf` / `anyOf` / `oneOf` / `not` / `if`, which the classifier marks
 * TEE/BUFFER), object/array `enum` / `const` (BUFFER), `contains`, and
 * `uniqueItems` over non-scalar items. The classifier filters the first
 * three out ahead of the spine; the throws are a backstop. `format` is
 * treated as a non-asserting annotation (its default in JSON Schema
 * 2020-12), so it does not affect the verdict.
 *
 * @packageDocumentation
 */

import type { PathSegment, SchemaObject, SchemaOrBoolean } from "@oav/core";
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
) => Violation[];

/** A schema violation. Codes are coarse for now; the channel layer refines them. */
export interface Violation {
  code: string;
  path: PathSegment[];
  /** Byte offset in the input stream nearest the violation (for re-sync). */
  byteOffset: number;
}

/** Options for {@link SpineValidator}. */
export interface SpineOptions {
  /** Called as each violation is recorded (lets a driver enforce a budget / terminate). */
  onViolation?: (violation: Violation) => void;
  /** Per-node strategy from the classifier. Absent: every node is treated as `stream`. */
  strategyOf?: (node: SchemaOrBoolean) => Strategy;
  /**
   * Validates a materialized BUFFER island against its schemas (the
   * in-memory engine). Required for any non-stream node; absent, such a
   * node throws {@link SpineUnsupportedError}.
   */
  delegate?: IslandDelegate;
  /** Cap on a single buffered island's UTF-8 source-byte span. Unset: no cap. */
  maxBufferedBytes?: number;
}

/** The verdict of a streaming validation. */
export interface SpineVerdict {
  valid: boolean;
  violations: Violation[];
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
}

interface ArrayFrame {
  kind: "array";
  schemas: SchemaObject[];
  count: number;
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
  private readonly violations: Violation[] = [];
  private readonly path: PathSegment[] = [];
  private readonly frames: Frame[] = [];
  private readonly regexCache = new Map<string, RegExp>();
  private readonly onViolation: ((violation: Violation) => void) | undefined;
  private readonly strategyOf: (node: SchemaOrBoolean) => Strategy;
  private readonly delegate: IslandDelegate | undefined;
  private readonly maxBufferedBytes: number | undefined;

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

  constructor(root: SchemaOrBoolean, options: SpineOptions = {}) {
    this.root = root;
    this.onViolation = options.onViolation;
    this.strategyOf = options.strategyOf ?? (() => "stream");
    this.delegate = options.delegate;
    this.maxBufferedBytes = options.maxBufferedBytes;
  }

  /** The verdict so far (final once `end` has been called on the tokenizer). */
  verdict(): SpineVerdict {
    return { valid: this.violations.length === 0, violations: this.violations };
  }

  private fail(code: string, path: PathSegment[] = this.path): void {
    const violation: Violation = { code, path: [...path], byteOffset: this.curOffset };
    this.violations.push(violation);
    this.onViolation?.(violation);
  }

  private regex(pattern: string): RegExp {
    let re = this.regexCache.get(pattern);
    if (re === undefined) {
      re = new RegExp(pattern, "u");
      this.regexCache.set(pattern, re);
    }
    return re;
  }

  // Expand a schema into the object schemas whose own keywords apply,
  // following `$ref` (with a cycle guard). A `false` sets hasFalse; a
  // `true` contributes nothing.
  private expand(s: SchemaOrBoolean | undefined, out: Applicable, seen: Set<object>): void {
    if (s === undefined || s === true) return;
    if (s === false) {
      out.hasFalse = true;
      return;
    }
    if (!isObjectSchema(s)) return;
    out.schemas.push(s);
    const ref = (s as Record<string, unknown>).$ref;
    if (typeof ref === "string") {
      const target = resolveRef(isObjectSchema(this.root) ? this.root : ({} as SchemaObject), ref);
      if (target !== undefined && !(isObjectSchema(target) && seen.has(target))) {
        if (isObjectSchema(target)) seen.add(target);
        this.expand(target, out, seen);
      }
    }
  }

  // The AND-list of schemas the value about to be parsed must satisfy.
  private schemasForValue(): Applicable {
    const out: Applicable = { schemas: [], hasFalse: false };
    const top = this.frames[this.frames.length - 1];
    if (top === undefined) {
      this.expand(this.root, out, new Set());
    } else if (top.kind === "object") {
      for (const s of top.schemas) this.collectObjectValue(s, top.pendingKey as string, out);
    } else {
      for (const s of top.schemas) this.collectArrayElement(s, top.count, out);
    }
    return out;
  }

  private collectObjectValue(s: SchemaObject, key: string, out: Applicable): void {
    const seen = new Set<object>();
    let matched = false;
    if (s.properties !== undefined && Object.hasOwn(s.properties, key)) {
      this.expand(s.properties[key], out, seen);
      matched = true;
    }
    if (s.patternProperties !== undefined) {
      for (const pat of Object.keys(s.patternProperties)) {
        if (this.regex(pat).test(key)) {
          this.expand(s.patternProperties[pat], out, seen);
          matched = true;
        }
      }
    }
    if (!matched && s.additionalProperties !== undefined) {
      this.expand(s.additionalProperties, out, seen);
    }
  }

  private collectArrayElement(s: SchemaObject, index: number, out: Applicable): void {
    const seen = new Set<object>();
    if (s.prefixItems !== undefined && index < s.prefixItems.length) {
      this.expand(s.prefixItems[index], out, seen);
    } else if (s.items !== undefined) {
      this.expand(s.items, out, seen);
    }
  }

  // Whether a single schema must be handled by materialization rather
  // than the forward state machines: the classifier marked it non-stream
  // (composition / object-array equality / dependentSchemas / ...), or it
  // carries a keyword the spine streams no forward path for yet
  // (`contains`, or composition keywords when no classification is wired).
  private isNonStream(s: SchemaObject): boolean {
    if (this.strategyOf(s) !== "stream") return true;
    if ("contains" in s) return true;
    // uniqueItems over container items needs canonical hashing the spine
    // doesn't do; materialize the whole array (correct for any element).
    if (s.uniqueItems === true) return true;
    for (const k of STREAM_COMPOSITION) if (k in s) return true;
    // enum/const with an object/array candidate needs deep equality.
    const complex = (v: unknown): boolean => typeof v === "object" && v !== null;
    if (Array.isArray(s.enum) && s.enum.some(complex)) return true;
    if ("const" in s && complex((s as { const?: unknown }).const)) return true;
    return false;
  }

  // Whether the value about to be parsed must be materialized + delegated.
  private needsIsland(app: Applicable): boolean {
    return app.schemas.some((s) => this.isNonStream(s));
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
    for (const v of delegate(app.schemas, value, [...this.path], this.curOffset)) {
      this.violations.push(v);
      this.onViolation?.(v);
    }
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
      this.violations.push(v);
      this.onViolation?.(v);
    }
    this.popSegment();
    this.advance();
  }

  private pushSegment(): void {
    const top = this.frames[this.frames.length - 1];
    if (top === undefined) return; // root value: no segment
    this.path.push(top.kind === "object" ? (top.pendingKey as string) : top.count);
  }

  private popSegment(): void {
    if (this.frames.length > 0) this.path.pop();
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
    this.pushSegment();
    if (app.hasFalse) this.fail("false");
    this.checkType(app.schemas, "object");
    this.frames.push({
      kind: "object",
      schemas: app.schemas,
      seen: new Set(),
      count: 0,
      pendingKey: null,
    });
  }

  onEndObject(offset: number): void {
    this.curOffset = offset;
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
    }
    this.popSegment();
    this.advance();
  }

  onStartArray(offset: number): void {
    this.curOffset = offset;
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
    this.pushSegment();
    if (app.hasFalse) this.fail("false");
    this.checkType(app.schemas, "array");
    this.frames.push({ kind: "array", schemas: app.schemas, count: 0 });
  }

  onEndArray(offset: number): void {
    this.curOffset = offset;
    if (this.island !== null) {
      this.forwardIsland((b) => b.onEndArray());
      return;
    }
    const frame = this.frames.pop() as ArrayFrame;
    for (const s of frame.schemas) {
      if (s.minItems !== undefined && frame.count < s.minItems) this.fail("minItems");
      if (s.maxItems !== undefined && frame.count > s.maxItems) this.fail("maxItems");
    }
    this.popSegment();
    this.advance();
  }

  onKey(value: string, codePoints: number, startOffset: number): void {
    this.curOffset = startOffset;
    if (this.island !== null) {
      this.forwardIsland((b) => b.onKey(value));
      return;
    }
    const top = this.frames[this.frames.length - 1] as ObjectFrame;
    for (const s of top.schemas) {
      if (s.propertyNames !== undefined) {
        const app: Applicable = { schemas: [], hasFalse: false };
        this.expand(s.propertyNames, app, new Set());
        const keyPath = [...this.path, value];
        if (app.hasFalse) this.fail("propertyNames", keyPath);
        for (const ps of app.schemas) {
          if (ps.type !== undefined && !typeMatches(ps.type, "string"))
            this.fail("propertyNames", keyPath);
          if (ps.minLength !== undefined && codePoints < ps.minLength)
            this.fail("propertyNames", keyPath);
          if (ps.maxLength !== undefined && codePoints > ps.maxLength)
            this.fail("propertyNames", keyPath);
          if (ps.pattern !== undefined && !this.regex(ps.pattern).test(value))
            this.fail("propertyNames", keyPath);
        }
      }
    }
    top.seen.add(value);
    top.count += 1;
    top.pendingKey = value;
  }

  onStringStart(offset: number): void {
    this.curOffset = offset;
    if (this.island !== null) {
      this.forwardIsland((b) => b.onStringStart());
      return;
    }
    const app = this.schemasForValue();
    const island = this.needsIsland(app);
    // Buffer the text when a forward keyword needs it (pattern / enum /
    // const) or when the value is a BUFFER island (delegated whole).
    const needText =
      island || app.schemas.some((s) => s.pattern !== undefined || "enum" in s || "const" in s);
    this.str = { app, needText, text: "", offset, island };
  }

  onStringChunk(chunk: string): void {
    if (this.island !== null) {
      this.forwardIsland((b) => b.onStringChunk(chunk));
      return;
    }
    if (this.str !== null && this.str.needText) this.str.text += chunk;
  }

  onStringEnd(codePoints: number): void {
    if (this.island !== null) {
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
    this.curOffset = s.offset;
    if (s.island) {
      this.delegateScalar(s.app, s.text);
      return;
    }
    this.scalar("string", s.needText ? s.text : "", codePoints, s.app);
  }

  onNumber(value: number, _raw: string, startOffset: number): void {
    this.curOffset = startOffset;
    if (this.island !== null) {
      this.forwardIsland((b) => b.onNumber(value));
      return;
    }
    this.scalar(Number.isInteger(value) ? "integer" : "number", value, 0, this.schemasForValue());
  }

  onBoolean(value: boolean, startOffset: number): void {
    this.curOffset = startOffset;
    if (this.island !== null) {
      this.forwardIsland((b) => b.onBoolean(value));
      return;
    }
    this.scalar("boolean", value, 0, this.schemasForValue());
  }

  onNull(startOffset: number): void {
    this.curOffset = startOffset;
    if (this.island !== null) {
      this.forwardIsland((b) => b.onNull());
      return;
    }
    this.scalar("null", null, 0, this.schemasForValue());
  }
}

// Mirror @oav/schema's tolerant multipleOf check so verdicts agree on
// floating-point divisors (see packages/schema/src/keywords/number.ts).
function isMultipleOf(value: number, divisor: number): boolean {
  const q = value / divisor;
  const tol = 16 * Number.EPSILON * Math.max(1, Math.abs(q), Math.abs(divisor));
  return Math.abs(q - Math.round(q)) <= tol;
}
