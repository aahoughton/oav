/**
 * End-to-end tests for `oav compile-spec`. Each test compiles a small
 * OpenAPI document through the real emit + esbuild bundle path, loads
 * the resulting module via a data URL, and compares its behavior
 * against `createValidator(document).validateRequest` on a fixture
 * matrix. A pass means the AOT output matches the runtime validator's
 * tree shape on the covered cases.
 */

import { describe, expect, it } from "vitest";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenAPIDocument, ValidationError } from "@oav/core";
import { createValidator } from "@oav/validator";
import { compileSpecCommand } from "../src/commands.js";
import { memoryIo } from "./fixtures.js";

const RESOLVE_DIR = resolvePath(fileURLToPath(new URL("../../oav", import.meta.url)));

const petstore: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Pets", version: "1" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
              },
            },
          },
        },
      },
      post: {
        operationId: "createPet",
        parameters: [
          { name: "X-Tenant", in: "header", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
        },
        responses: { "201": { description: "created" } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          tag: { type: "string" },
        },
      },
    },
  },
};

interface AotValidator {
  validateRequest: (req: unknown) => ValidationError | null;
  validateResponse: (req: unknown, res: unknown) => ValidationError | null;
  getOperation: (req: {
    method: string;
    path: string;
  }) => { pathPattern: string; pathItem: unknown; operation: unknown } | null;
  detectedVersion: string | undefined;
  warnings: readonly string[];
}

async function buildAot(
  document: OpenAPIDocument,
  extra: {
    requestsOnly?: boolean;
    only?: Array<{ method: string; path: string }>;
  } = {},
): Promise<AotValidator> {
  const mem = memoryIo([["spec.json", document]]);
  const res = await compileSpecCommand(
    {
      spec: "spec.json",
      overlays: [],
      output: "out.mjs",
      importPrefix: "@oav",
      resolveDir: RESOLVE_DIR,
      requestsOnly: extra.requestsOnly,
      only: extra.only,
    },
    mem.io,
  );
  if (res.exitCode !== 0) {
    throw new Error(`compile-spec failed (${res.exitCode}): ${mem.stderr.value}`);
  }
  const bundled = mem.writes[0]?.[1];
  if (bundled === undefined) throw new Error("no output written");
  return (await import(
    `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`
  )) as AotValidator;
}

/** Compare two ValidationError trees for structural equivalence (code paths + leaf codes). */
function equivalent(a: ValidationError | null, b: ValidationError | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.code !== b.code) return false;
  const aLeaves = collectLeafCodes(a);
  const bLeaves = collectLeafCodes(b);
  if (aLeaves.length !== bLeaves.length) return false;
  for (let i = 0; i < aLeaves.length; i++) if (aLeaves[i] !== bLeaves[i]) return false;
  return true;
}

function collectLeafCodes(err: ValidationError): string[] {
  if (err.children.length === 0) return [err.code];
  return err.children.flatMap(collectLeafCodes);
}

describe("compile-spec: equivalence vs createValidator", () => {
  it("matches runtime output on the petstore matrix", async () => {
    const runtime = createValidator(petstore);
    const aot = await buildAot(petstore);

    const cases: Array<{ name: string; req: unknown }> = [
      {
        name: "valid POST /pets",
        req: {
          method: "POST",
          path: "/pets",
          contentType: "application/json",
          headers: { "x-tenant": "acme" },
          body: { name: "Fido" },
        },
      },
      {
        name: "invalid POST /pets (missing required `name`)",
        req: {
          method: "POST",
          path: "/pets",
          contentType: "application/json",
          headers: { "x-tenant": "acme" },
          body: { tag: "dog" },
        },
      },
      {
        name: "POST /pets missing required X-Tenant header",
        req: {
          method: "POST",
          path: "/pets",
          contentType: "application/json",
          body: { name: "Fido" },
        },
      },
      {
        name: "POST /pets wrong content-type → 415",
        req: {
          method: "POST",
          path: "/pets",
          contentType: "text/plain",
          headers: { "x-tenant": "acme" },
          body: "raw",
        },
      },
      {
        name: "valid GET /pets",
        req: { method: "GET", path: "/pets", query: { limit: "25" } },
      },
      {
        name: "GET /pets invalid limit (maximum:100)",
        req: { method: "GET", path: "/pets", query: { limit: "999" } },
      },
      {
        name: "POST /unknown → route (404)",
        req: { method: "POST", path: "/unknown", contentType: "application/json", body: {} },
      },
      {
        name: "DELETE /pets → method (405)",
        req: { method: "DELETE", path: "/pets" },
      },
    ];

    for (const c of cases) {
      const a = runtime.validateRequest(c.req as never);
      const b = aot.validateRequest(c.req);
      if (!equivalent(a, b)) {
        console.error(
          `${c.name}\n  runtime: ${a === null ? "ok" : `${a.code} / ${collectLeafCodes(a).join(",")}`}\n  aot:     ${b === null ? "ok" : `${b.code} / ${collectLeafCodes(b).join(",")}`}`,
        );
      }
      expect(equivalent(a, b), c.name).toBe(true);
    }
  });

  it("detectedVersion matches the spec's openapi bucket", async () => {
    const aot = await buildAot(petstore);
    expect(aot.detectedVersion).toBe("3.1");
  });

  it("warnings is an empty readonly array for a clean spec", async () => {
    const aot = await buildAot(petstore);
    expect(aot.warnings).toEqual([]);
  });

  it("warnings carries an unknown-minor fallback into the emitted module", async () => {
    const weird = { ...petstore, openapi: "3.7.0" };
    const aot = await buildAot(weird);
    expect(aot.detectedVersion).toBe(undefined);
    expect(aot.warnings.length).toBe(1);
    expect(aot.warnings[0]).toMatch(/3\.7\.0.*unknown 3\.x minor.*3\.1/);
    expect(Object.isFrozen(aot.warnings)).toBe(true);
  });

  it("warnings carries a missing-openapi fallback into the emitted module", async () => {
    const noVersion = { ...petstore } as Partial<OpenAPIDocument> as OpenAPIDocument;
    delete (noVersion as { openapi?: unknown }).openapi;
    const aot = await buildAot(noVersion);
    expect(aot.warnings.length).toBe(1);
    expect(aot.warnings[0]).toMatch(/openapi.*field.*must be a string/);
  });

  it("getOperation resolves a known (method, path)", async () => {
    const aot = await buildAot(petstore);
    expect(aot.getOperation({ method: "POST", path: "/pets" })?.pathPattern).toBe("/pets");
    expect(aot.getOperation({ method: "GET", path: "/unknown" })).toBe(null);
  });

  it("getOperation returns the full pathItem and operation objects", async () => {
    const aot = await buildAot(petstore);
    const info = aot.getOperation({ method: "POST", path: "/pets" });
    expect(info).not.toBe(null);
    const op = info?.operation as { operationId?: string; requestBody?: { required?: boolean } };
    expect(op.operationId).toBe("createPet");
    expect(op.requestBody?.required).toBe(true);
    const pathItem = info?.pathItem as { post?: { operationId?: string }; get?: unknown };
    expect(pathItem.post?.operationId).toBe("createPet");
    expect(pathItem.get).toBeDefined();
  });

  it("getOperation shape matches createValidator().getOperation", async () => {
    const runtime = createValidator(petstore);
    const aot = await buildAot(petstore);
    const target = { method: "POST", path: "/pets" };
    const rt = runtime.getOperation(target);
    const at = aot.getOperation(target);
    expect(at?.pathPattern).toBe(rt?.pathPattern);
    const rtOp = rt?.operation as { operationId?: string } | undefined;
    const atOp = at?.operation as { operationId?: string } | undefined;
    expect(atOp?.operationId).toBe(rtOp?.operationId);
  });
});

describe("compile-spec --requests-only", () => {
  it("emits a validateResponse that passes through (returns null)", async () => {
    const aot = await buildAot(petstore, { requestsOnly: true });
    const r = aot.validateResponse(
      { method: "GET", path: "/pets" },
      { status: 999, contentType: "application/json", body: [{ shape: "wrong" }] },
    );
    expect(r).toBe(null);
  });

  it("still validates requests correctly", async () => {
    const aot = await buildAot(petstore, { requestsOnly: true });
    const valid = aot.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      headers: { "x-tenant": "acme" },
      body: { name: "Fido" },
    });
    expect(valid).toBe(null);
  });
});

describe("compile-spec --only", () => {
  it("returns exit code 2 when the spec file can't be loaded", async () => {
    // No `spec.json` in the memory reader → loadSpec throws → exit 2.
    // (Exit 3 is reserved for compile/bundle failures after a successful
    // load.) Pin the distinction so a future refactor can't collapse them.
    const mem = memoryIo([]);
    const res = await compileSpecCommand(
      {
        spec: "spec.json",
        overlays: [],
        output: "out.mjs",
        importPrefix: "@oav",
        resolveDir: RESOLVE_DIR,
      },
      mem.io,
    );
    expect(res.exitCode).toBe(2);
    expect(mem.stderr.value).toContain("compile-spec:");
  });

  it("drops unincluded ops from the router (→ route error on call)", async () => {
    // Include only POST /pets; GET /pets is dropped.
    const aot = await buildAot(petstore, {
      only: [{ method: "POST", path: "/pets" }],
    });
    // POST /pets still works
    const included = aot.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      headers: { "x-tenant": "acme" },
      body: { name: "Fido" },
    });
    expect(included).toBe(null);

    // GET /pets dropped → route miss (404)
    const dropped = aot.validateRequest({ method: "GET", path: "/pets" });
    expect(dropped?.code).toBe("route");
  });
});
