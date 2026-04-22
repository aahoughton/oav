import { describe, expect, it } from "vitest";
import { resolveCommand, validateCommand, type CommandOptions } from "../src/commands.js";
import { memoryIo } from "./fixtures.js";

const textOpts: CommandOptions = { format: "text", quiet: false };

describe("resolveCommand", () => {
  it("stitches overlays into the resolved spec", async () => {
    const { io, stdout } = memoryIo([
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
    const doc = JSON.parse(stdout.value);
    expect(doc.paths["/pets"]).toBeDefined();
    expect(doc.paths["/health"]).toBeDefined();
  });

  it("writes the resolved spec to the output path when given and stays silent on stdout", async () => {
    const { io, writes, stdout } = memoryIo([
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
      { spec: "spec.json", overlays: [], options: { ...textOpts, output: "out.json" } },
      io,
    );
    expect(result.exitCode).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe("out.json");
    expect(writes[0]?.[1]).toContain('"openapi"');
    // Regression: `-o` used to write both to the file AND stdout.
    expect(stdout.value).toBe("");
  });

  it("suppresses stdout when --quiet is set", async () => {
    const { io, stdout } = memoryIo([
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
    expect(result.exitCode).toBe(0);
    expect(stdout.value).toBe("");
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

  it("exits 0 when the body satisfies the schema, with nothing on stdout", async () => {
    const { io, stdout } = memoryIo(
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
    // Silence on success — no bare newline leak.
    expect(stdout.value).toBe("");
  });

  it("exits 1 when the body is missing a required field", async () => {
    const { io, stdout } = memoryIo([["spec.json", specWithRequiredBody()]], [["body.json", "{}"]]);
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
    expect(stdout.value).toMatch(/required/i);
  });

  it("writes the rendered error to --output when given and stays silent on stdout", async () => {
    const { io, writes, stdout } = memoryIo(
      [["spec.json", specWithRequiredBody()]],
      [["body.json", "{}"]],
    );
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
    // Regression: `-o` used to write both to the file AND stdout.
    expect(stdout.value).toBe("");
  });
});
