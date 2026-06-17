/**
 * The SAX event contract the tokenizer drives.
 *
 * Realized as a handler-callback interface, not per-token objects: a
 * large document is tens of millions of tokens, so one allocation per
 * token would be GC thrash that dominates runtime. The tokenizer calls
 * these methods with primitive arguments. Offsets are raw **byte**
 * offsets from the start of the stream, never decoded character
 * positions.
 *
 * Strings stream as chunks (`onStringStart`, then 0+ `onStringChunk`,
 * then `onStringEnd`); keys and numbers are delivered whole (a key
 * because dispatch to `properties[k]` needs all of it, a number because
 * the value needs the complete literal).
 *
 * @packageDocumentation
 */

/**
 * Receives parse events from {@link JsonTokenizer}. Every method is
 * synchronous; the tokenizer calls them in document order.
 *
 * @public
 */
export interface JsonEventHandler {
  /** `{` consumed. */
  onStartObject(offset: number): void;
  /** `}` consumed; the enclosing object is complete. */
  onEndObject(offset: number): void;
  /** `[` consumed. */
  onStartArray(offset: number): void;
  /** `]` consumed; the enclosing array is complete. */
  onEndArray(offset: number): void;
  /**
   * An object member key, delivered whole and decoded.
   *
   * @param value - The decoded key string.
   * @param codePoints - The key's length in Unicode code points
   *   (escape-aware: a `\u` surrogate-escape pair counts 1).
   * @param startOffset - Byte offset of the opening quote.
   * @param endOffset - Byte offset just past the closing quote.
   */
  onKey(value: string, codePoints: number, startOffset: number, endOffset: number): void;
  /** A value string is beginning; the opening quote is at `offset`. */
  onStringStart(offset: number): void;
  /**
   * A decoded slice of the current value string. Emitted 0+ times
   * between {@link onStringStart} and {@link onStringEnd}; never empty.
   *
   * @param chunk - Decoded text (escapes resolved, UTF-8 decoded).
   * @param offset - Byte offset of this slice's first source byte.
   */
  onStringChunk(chunk: string, offset: number): void;
  /**
   * The current value string is complete.
   *
   * @param codePoints - Total length in Unicode code points
   *   (escape-aware), accumulated across the emitted chunks.
   * @param startOffset - Byte offset of the opening quote.
   * @param endOffset - Byte offset just past the closing quote.
   */
  onStringEnd(codePoints: number, startOffset: number, endOffset: number): void;
  /**
   * A complete number literal.
   *
   * @param value - The numeric value (`Number(raw)`; a JS double, so a
   *   huge literal yields the same `Infinity` / rounded value
   *   `JSON.parse` gives).
   * @param raw - The source text of the literal.
   * @param startOffset - Byte offset of the first character.
   * @param endOffset - Byte offset just past the last character.
   */
  onNumber(value: number, raw: string, startOffset: number, endOffset: number): void;
  /** A `true` / `false` literal. */
  onBoolean(value: boolean, startOffset: number, endOffset: number): void;
  /** A `null` literal. */
  onNull(startOffset: number, endOffset: number): void;
}
