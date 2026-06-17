/**
 * Splits stream-validation cost into tokenizer vs spine, so an
 * optimization targets the real bottleneck.
 *
 *   tsx profile-stream.ts            # default 32 MB
 *   PROFILE_MB=64 tsx profile-stream.ts
 */

import type { JsonEventHandler } from "../packages/stream-validator/src/tokenizer/index.ts";
import { JsonTokenizer } from "../packages/stream-validator/src/tokenizer/index.ts";
import { SpineValidator } from "../packages/stream-validator/src/spine/index.ts";
import { classify } from "../packages/stream-validator/src/classifier/index.ts";
import type { SchemaOrBoolean } from "../packages/core/src/index.ts";

const MB = 1024 * 1024;
const SCHEMA: SchemaOrBoolean = {
  type: "array",
  items: {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "integer", minimum: 1 },
      name: { type: "string", minLength: 1 },
      active: { type: "boolean" },
      tags: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
};

const targetBytes = Number(process.env.PROFILE_MB ?? 32) * MB;

function buildPayload(): Buffer {
  const chunks: Buffer[] = [];
  let emitted = 0;
  let i = 0;
  let pending = "[";
  while (emitted < targetBytes) {
    const piece =
      (i === 0 ? "" : ",") +
      `{"id":${i + 1},"name":"item-${i}","active":${i % 2 === 0},"tags":["a","b","c"]}`;
    pending += piece;
    emitted += piece.length + 1;
    i += 1;
    if (pending.length >= 8 * MB) {
      chunks.push(Buffer.from(pending, "utf8"));
      pending = "";
    }
  }
  chunks.push(Buffer.from(pending + "]", "utf8"));
  return Buffer.concat(chunks);
}

// A handler that does the minimum: counts events. Isolates tokenizer cost.
class CountingHandler implements JsonEventHandler {
  n = 0;
  onStartObject(): void {
    this.n++;
  }
  onEndObject(): void {
    this.n++;
  }
  onStartArray(): void {
    this.n++;
  }
  onEndArray(): void {
    this.n++;
  }
  onKey(): void {
    this.n++;
  }
  onStringStart(): void {
    this.n++;
  }
  onStringChunk(): void {
    this.n++;
  }
  onStringEnd(): void {
    this.n++;
  }
  onNumber(): void {
    this.n++;
  }
  onBoolean(): void {
    this.n++;
  }
  onNull(): void {
    this.n++;
  }
}

const CHUNK = 64 * 1024;

function feed(payload: Buffer, handler: JsonEventHandler): void {
  const tok = new JsonTokenizer(handler);
  for (let off = 0; off < payload.length; off += CHUNK) {
    tok.write(payload.subarray(off, Math.min(off + CHUNK, payload.length)));
  }
  tok.end();
}

function time(label: string, payload: Buffer, make: () => JsonEventHandler, reps: number): void {
  // warm up
  feed(payload, make());
  const start = process.hrtime.bigint();
  for (let r = 0; r < reps; r++) feed(payload, make());
  const secs = Number(process.hrtime.bigint() - start) / 1e9;
  const mbps = (payload.length * reps) / MB / secs;
  console.log(
    `${label.padEnd(26)} ${mbps.toFixed(0).padStart(5)} MB/s   (${(secs / reps).toFixed(2)}s/run)`,
  );
}

const payload = buildPayload();
const strategyOf = classify(SCHEMA).strategyOf;
console.log(`\npayload: ${(payload.length / MB).toFixed(0)} MB, array of typed objects\n`);

const reps = 3;
time("tokenizer only (count)", payload, () => new CountingHandler(), reps);
time("tokenizer + spine", payload, () => new SpineValidator(SCHEMA, { strategyOf }), reps);
