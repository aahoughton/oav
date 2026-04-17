import { describe, expect, it } from "vitest";
import { createMemoryReader, type DocumentReader } from "@oav/spec";
import {
  resolveCommand,
  validateCommand,
  type CommandIo,
  type CommandOptions,
} from "../src/commands.js";

function memoryIo(
  entries: Array<[string, unknown]>,
  textFiles: Array<[string, string]> = [],
): { io: CommandIo; writes: Array<[string, string]>; textMap: Map<string, string> } {
  const reader: DocumentReader = createMemoryReader(new Map(entries));
  const textMap = new Map(textFiles);
  const writes: Array<[string, string]> = [];
  return {
    io: {
      reader,
      async readText(path: string) {
        const hit = textMap.get(path);
        if (hit === undefined) throw new Error(`missing text file: ${path}`);
        return hit;
      },
      async writeText(path: string, content: string) {
        writes.push([path, content]);
      },
    },
    writes,
    textMap,
  };
}

const textOpts: CommandOptions = { format: "text", quiet: false };

describe("resolveCommand", () => {
  it("stitches overlays into the resolved spec", async () => {
    const { io } = memoryIo([
      [
        "spec.json",
        {
          openapi: "3.1.0",
          info: { title: "X", version: "1" },
          paths: { "/pets": { get: { responses: { "200": { description: "ok" } } } } },
        },
      ],
      [
        "overlay.json",
        { addPaths: { "/health": { get: { responses: { "200": { description: "ok" } } } } } },
      ],
    ]);
    const result = await resolveCommand(
      { spec: "spec.json", overlays: ["overlay.json"], options: textOpts },
      io,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toBeDefined();
    const doc = JSON.parse(result.output ?? "");
    expect(doc.paths["/pets"]).toBeDefined();
    expect(doc.paths["/health"]).toBeDefined();
  });

  it("writes the resolved spec to the output path when given", async () => {
    const { io, writes } = memoryIo([
      [
        "spec.json",
        {
          openapi: "3.1.0",
          info: { title: "X", version: "1" },
          paths: {},
        },
      ],
    ]);
    await resolveCommand(
      { spec: "spec.json", overlays: [], options: { ...textOpts, output: "out.json" } },
      io,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe("out.json");
    expect(writes[0]?.[1]).toContain('"openapi"');
  });

  it("suppresses stdout output when --quiet is set", async () => {
    const { io } = memoryIo([
      [
        "spec.json",
        {
          openapi: "3.1.0",
          info: { title: "X", version: "1" },
          paths: {},
        },
      ],
    ]);
    const result = await resolveCommand(
      { spec: "spec.json", overlays: [], options: { ...textOpts, quiet: true } },
      io,
    );
    expect(result.output).toBeUndefined();
  });
});

describe("validateCommand", () => {
  function specWithRequiredBody(): unknown {
    return {
      openapi: "3.1.0",
      info: { title: "X", version: "1" },
      paths: {
        "/pets": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object", required: ["name"] },
                },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
  }

  it("exits 0 when the body satisfies the schema", async () => {
    const { io } = memoryIo(
      [["spec.json", specWithRequiredBody()]],
      [["body.json", '{"name":"a"}']],
    );
    const result = await validateCommand(
      {
        spec: "spec.json",
        overlays: [],
        mode: { kind: "bodyForPath", method: "POST", path: "/pets", body: "body.json" },
        options: textOpts,
      },
      io,
    );
    expect(result.exitCode).toBe(0);
  });

  it("exits 1 when the body is missing a required field", async () => {
    const { io } = memoryIo([["spec.json", specWithRequiredBody()]], [["body.json", "{}"]]);
    const result = await validateCommand(
      {
        spec: "spec.json",
        overlays: [],
        mode: { kind: "bodyForPath", method: "POST", path: "/pets", body: "body.json" },
        options: textOpts,
      },
      io,
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/required/i);
  });

  it("writes the rendered error to --output when given", async () => {
    const { io, writes } = memoryIo([["spec.json", specWithRequiredBody()]], [["body.json", "{}"]]);
    const result = await validateCommand(
      {
        spec: "spec.json",
        overlays: [],
        mode: { kind: "bodyForPath", method: "POST", path: "/pets", body: "body.json" },
        options: { ...textOpts, output: "err.txt" },
      },
      io,
    );
    expect(result.exitCode).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe("err.txt");
    expect(writes[0]?.[1]).toMatch(/required/i);
  });
});
