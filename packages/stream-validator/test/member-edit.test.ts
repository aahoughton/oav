import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import type { SchemaOrBoolean } from "@oav/core";
import {
  createStreamValidator,
  type MemberContext,
  type MemberEdit,
  type StreamValidator,
} from "../src/index.js";

const enc = new TextEncoder();

interface RunResult {
  output: string;
  err: Error | undefined;
  valid: boolean | undefined;
}

async function run(
  schema: SchemaOrBoolean,
  json: string,
  setup: (v: StreamValidator) => void,
  opts: Record<string, unknown> = {},
  chunkSize = 0,
): Promise<RunResult> {
  const v = createStreamValidator(schema, opts as never);
  setup(v);
  v.on("error", () => {});
  const out: Buffer[] = [];
  const sink = new Writable({
    write(c: Buffer, _e, cb) {
      out.push(Buffer.from(c));
      cb();
    },
  });
  const bytes = enc.encode(json);
  const chunks =
    chunkSize > 0
      ? Array.from({ length: Math.ceil(bytes.length / chunkSize) }, (_, i) =>
          Buffer.from(bytes.subarray(i * chunkSize, (i + 1) * chunkSize)),
        )
      : [Buffer.from(bytes)];
  let err: Error | undefined;
  try {
    await pipeline(Readable.from(chunks), v, sink);
  } catch (e) {
    err = e as Error;
  }
  const verdict = await v.result.then(
    (r) => r.valid,
    () => undefined,
  );
  return { output: Buffer.concat(out).toString("utf8"), err, valid: verdict };
}

const rename = (key: string) => (): MemberEdit => ({ action: "rename", key });
const drop = (): MemberEdit => ({ action: "drop" });

describe("editMember rename", () => {
  it("renames a scalar key, value verbatim", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2}', (v) =>
      v.editMember(["a"], rename("z")),
    );
    expect(r.output).toBe('{"z":1,"b":2}');
    expect(r.valid).toBe(true);
  });

  it("renames a key whose value is an array, streaming the array verbatim", async () => {
    const schema = { type: "object", properties: { ids: { type: "array" } } };
    const r = await run(schema, '{"ids":[1,2,3,4,5]}', (v) =>
      v.editMember(["ids"], rename("records")),
    );
    expect(r.output).toBe('{"records":[1,2,3,4,5]}');
    expect(r.valid).toBe(true);
  });

  it("renames a key whose value is an object", async () => {
    const r = await run({ type: "object" }, '{"meta":{"x":1}}', (v) =>
      v.editMember(["meta"], rename("m")),
    );
    expect(r.output).toBe('{"m":{"x":1}}');
  });

  it("only renames the targeted (full-path) member", async () => {
    const r = await run({ type: "object" }, '{"a":{"a":1}}', (v) =>
      v.editMember(["a"], rename("z")),
    );
    // The nested "a" is at path ["a","a"], not matched by ["a"].
    expect(r.output).toBe('{"z":{"a":1}}');
  });

  it("renames correctly across tiny chunk boundaries", async () => {
    const schema = { type: "object", properties: { message_ids: { type: "array" } } };
    const json = '{"message_ids":["x","y","z"],"batch":7}';
    for (const cs of [1, 2, 3, 5, 8]) {
      const r = await run(
        schema,
        json,
        (v) => v.editMember(["message_ids"], rename("records")),
        {},
        cs,
      );
      expect(r.output, `chunk size ${cs}`).toBe('{"records":["x","y","z"],"batch":7}');
      expect(r.valid).toBe(true);
    }
  });

  it("preserves whitespace/formatting around the renamed key", async () => {
    const r = await run({ type: "object" }, '{\n  "a" : 1\n}', (v) =>
      v.editMember(["a"], rename("zz")),
    );
    expect(r.output).toBe('{\n  "zz" : 1\n}');
  });
});

describe("editMember rename does not buffer the value", () => {
  it("renames a key over a large array under a tiny maxBufferedBytes", async () => {
    // A value far larger than the cap: if rename buffered it, the cap would trip.
    const schema = {
      type: "object",
      properties: { ids: { type: "array", items: { type: "number" } } },
    };
    const big = Array.from({ length: 20000 }, (_, i) => i).join(",");
    const json = `{"ids":[${big}]}`;
    const r = await run(
      schema,
      json,
      (v) => v.editMember(["ids"], rename("records")),
      { maxBufferedBytes: 64 },
      256,
    );
    expect(r.valid).toBe(true);
    expect(r.err).toBeUndefined();
    expect(r.output).toBe(`{"records":[${big}]}`);
  });
});

describe("editMember drop", () => {
  it("drops a middle member (absorbs the following comma)", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2,"c":3}', (v) =>
      v.editMember(["b"], drop),
    );
    expect(r.output).toBe('{"a":1,"c":3}');
    expect(r.valid).toBe(true);
  });

  it("drops the first member", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2}', (v) => v.editMember(["a"], drop));
    expect(r.output).toBe('{"b":2}');
  });

  it("drops the last member (absorbs the preceding comma)", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2}', (v) => v.editMember(["b"], drop));
    expect(r.output).toBe('{"a":1}');
  });

  it("drops the only member", async () => {
    const r = await run({ type: "object" }, '{"a":1}', (v) => v.editMember(["a"], drop));
    expect(JSON.parse(r.output)).toEqual({});
  });

  it("drops two consecutive members", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2,"c":3,"d":4}', (v) => {
      v.editMember(["b"], drop);
      v.editMember(["c"], drop);
    });
    expect(r.output).toBe('{"a":1,"d":4}');
  });

  it("drops trailing members after a kept array sibling", async () => {
    const schema = { type: "object", properties: { ids: { type: "array" } } };
    const r = await run(schema, '{"ids":[1,2,3],"x":1,"y":2}', (v) => {
      v.editMember(["x"], drop);
      v.editMember(["y"], drop);
    });
    expect(r.output).toBe('{"ids":[1,2,3]}');
    expect(r.valid).toBe(true);
  });

  it("drops a deprecated scalar across chunk boundaries", async () => {
    const json = '{"keep":"v","old":"deprecated","tail":3}';
    for (const cs of [1, 2, 4, 7]) {
      const r = await run({ type: "object" }, json, (v) => v.editMember(["old"], drop), {}, cs);
      expect(r.output, `chunk size ${cs}`).toBe('{"keep":"v","tail":3}');
    }
  });

  it("still validates a dropped member (validate-by-default)", async () => {
    const schema = {
      type: "object",
      properties: { gone: { type: "number" } },
    };
    // "gone" is a string but the schema says number: invalid even though dropped.
    const r = await run(schema, '{"gone":"x","keep":1}', (v) => v.editMember(["gone"], drop), {
      maxErrors: Number.POSITIVE_INFINITY,
      policy: "detach",
    });
    expect(r.valid).toBe(false);
    expect(r.output).toBe('{"keep":1}');
  });
});

describe("editMember rename + drop together", () => {
  it("renames one member and drops another", async () => {
    const schema = { type: "object", properties: { ids: { type: "array" } } };
    const r = await run(schema, '{"ids":[1,2],"old":true,"keep":9}', (v) => {
      v.editMember(["ids"], rename("records"));
      v.editMember(["old"], drop);
    });
    expect(r.output).toBe('{"records":[1,2],"keep":9}');
    expect(JSON.parse(r.output)).toEqual({ records: [1, 2], keep: 9 });
  });
});

describe("editMember collisions and conflicts are fatal", () => {
  it("fails when a rename target duplicates an existing later key", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2}', (v) =>
      v.editMember(["a"], rename("b")),
    );
    expect(r.err).toBeDefined();
    expect(r.err?.name).toBe("MemberEditError");
  });

  it("fails when a rename target duplicates an existing earlier key", async () => {
    const r = await run({ type: "object" }, '{"b":2,"a":1}', (v) =>
      v.editMember(["a"], rename("b")),
    );
    expect(r.err?.name).toBe("MemberEditError");
  });

  it("allows a key swap (rename a->b while b->c)", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2}', (v) => {
      v.editMember(["a"], rename("b"));
      v.editMember(["b"], rename("c"));
    });
    expect(r.err).toBeUndefined();
    expect(r.output).toBe('{"b":1,"c":2}');
  });

  it("fails on conflicting hooks for one member", async () => {
    const r = await run({ type: "object" }, '{"a":1}', (v) => {
      v.editMember(["a"], rename("x"));
      v.editMember(["a"], rename("y"));
    });
    expect(r.err?.name).toBe("MemberEditError");
  });

  it("tolerates two hooks that agree (same rename)", async () => {
    const r = await run({ type: "object" }, '{"a":1}', (v) => {
      v.editMember(["a"], rename("x"));
      v.editMember(["a"], rename("x"));
    });
    expect(r.err).toBeUndefined();
    expect(r.output).toBe('{"x":1}');
  });
});

describe("editMember caps", () => {
  it("fails when colon-to-value whitespace exceeds maxMemberPrefixBytes", async () => {
    const pad = " ".repeat(64);
    const r = await run(
      { type: "object" },
      `{"a":${pad}1}`,
      (v) => v.editMember(["a"], rename("z")),
      {
        maxMemberPrefixBytes: 16,
      },
    );
    expect(r.err?.name).toBe("MemberEditError");
  });

  it("fails when a dropped member's span exceeds maxMemberDropBytes", async () => {
    const big = "x".repeat(200);
    const r = await run(
      { type: "object" },
      `{"a":"${big}","b":2}`,
      (v) => v.editMember(["a"], drop),
      {
        maxMemberDropBytes: 32,
      },
    );
    expect(r.err?.name).toBe("MemberEditError");
  });

  it("rejects a container drop as unsupported", async () => {
    const schema = { type: "object", properties: { obj: { type: "object" } } };
    const r = await run(schema, '{"obj":{"x":1}}', (v) => v.editMember(["obj"], drop));
    expect(r.err?.name).toBe("MemberEditError");
  });
});

describe("editMember nested objects", () => {
  it("renames and drops members in a nested object selected by full path", async () => {
    const schema = { type: "object", properties: { inner: { type: "object" } } };
    const r = await run(schema, '{"inner":{"a":1,"b":2,"c":3}}', (v) => {
      v.editMember(["inner", "a"], rename("z"));
      v.editMember(["inner", "b"], drop);
    });
    expect(r.output).toBe('{"inner":{"z":1,"c":3}}');
    expect(JSON.parse(r.output)).toEqual({ inner: { z: 1, c: 3 } });
  });

  it("keep is a no-op (returning null too)", async () => {
    const r = await run({ type: "object" }, '{"a":1,"b":2}', (v) => {
      v.editMember(["a"], () => ({ action: "keep" }));
      v.editMember(["b"], () => null);
    });
    expect(r.output).toBe('{"a":1,"b":2}');
  });

  it("exposes the member context (path, key, valueType)", async () => {
    const seen: MemberContext[] = [];
    await run({ type: "object" }, '{"s":"x","n":1,"arr":[]}', (v) =>
      v.editMember(
        () => true,
        (m) => {
          seen.push(m);
          return { action: "keep" };
        },
      ),
    );
    expect(seen.map((m) => [m.key, m.valueType])).toEqual([
      ["s", "string"],
      ["n", "number"],
      ["arr", "array"],
    ]);
  });
});
