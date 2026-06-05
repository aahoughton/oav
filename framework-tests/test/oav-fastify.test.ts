import { type OpenAPIDocument } from "@oav/core";
import { httpRequestFromFastify, renderProblemDetails, validateRequests } from "@oav/oav-fastify";
import { createValidator } from "@oav/validator";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-server integration tests against Fastify. Uses
 * `fastify.inject()` (Fastify-native synthetic-request API) instead
 * of `app.listen(0)` + native fetch; `inject` is so idiomatic in
 * Fastify-land that bending the cross-adapter native-fetch
 * convention here earns its keep. Same `it()` names as the Express
 * adapters' integration suites; the implementations differ only
 * where Fastify diverges from Express.
 */

function petSpec(): OpenAPIDocument {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths: {
      "/pets": {
        post: {
          parameters: [
            { name: "x-tenant", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: { "200": { description: "ok" } },
        },
        get: {
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}

describe("oav-fastify integration: default validateRequests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    app = Fastify();
    app.addHook("preValidation", validateRequests(validator));
    app.post("/pets", async () => ({ ok: true, kind: "post" }));
    app.get("/pets", async () => ({ ok: true, kind: "get" }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("valid request reaches the handler", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      payload: JSON.stringify({ name: "Fido" }),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, kind: "post" });
  });

  it("invalid request returns 400 problem+details", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      payload: JSON.stringify({}),
    });
    expect(r.statusCode).toBe(400);
    expect(r.headers["content-type"]).toMatch(/application\/problem\+json/);
    const body = r.json() as { title: string; issues: unknown[] };
    expect(body.title).toBe("Validation failed");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("wrong verb returns 405 with Allow header", async () => {
    const r = await app.inject({ method: "DELETE", url: "/pets" });
    expect(r.statusCode).toBe(405);
    const allow = (r.headers.allow as string | undefined) ?? "";
    expect(allow).toMatch(/POST/);
    expect(allow).toMatch(/GET/);
  });

  it("unknown path returns 404", async () => {
    const r = await app.inject({ method: "GET", url: "/nope" });
    expect(r.statusCode).toBe(404);
  });

  it("missing required header returns 400 problem+details", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "Fido" }),
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { issues: Array<{ code: string }> };
    expect(body.issues.some((i) => i.code === "header-param")).toBe(true);
  });

  it("unmatched Content-Type returns 415", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "text/plain", "x-tenant": "acme" },
      payload: "not json",
    });
    expect(r.statusCode).toBe(415);
  });
});

describe("oav-fastify integration: custom onError", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    app = Fastify();
    app.addHook(
      "preValidation",
      validateRequests(validator, {
        onError: (_err, ctx) => {
          ctx.reply.code(422).send({ kind: "custom-envelope" });
        },
      }),
    );
    app.post("/pets", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("custom onError runs and writes a custom envelope; handler not reached", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      payload: JSON.stringify({}),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ kind: "custom-envelope" });
  });
});

describe("oav-fastify integration: async onError", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    app = Fastify();
    app.addHook(
      "preValidation",
      validateRequests(validator, {
        onError: async (err, ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          renderProblemDetails(err, ctx);
        },
      }),
    );
    app.post("/pets", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("async onError is awaited before the response settles", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      payload: JSON.stringify({}),
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { title: string };
    expect(body.title).toBe("Validation failed");
  });
});

describe("oav-fastify integration: custom toHttpRequest", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    app = Fastify();
    app.addHook("preHandler", async (request) => {
      (request as FastifyRequest & { verifiedBody?: unknown }).verifiedBody = { name: "Fido" };
    });
    app.addHook(
      "preValidation",
      validateRequests(validator, {
        toHttpRequest: (request) => {
          const httpReq = httpRequestFromFastify(request);
          const fancy = (request as FastifyRequest & { verifiedBody?: unknown }).verifiedBody;
          if (fancy !== undefined) httpReq.body = fancy;
          return httpReq;
        },
      }),
    );
    // preHandler runs after preValidation; need to set verifiedBody earlier.
    app.addHook("onRequest", async (request) => {
      (request as FastifyRequest & { verifiedBody?: unknown }).verifiedBody = { name: "Fido" };
    });
    app.post("/pets", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("custom toHttpRequest extractor reaches the validator", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      payload: JSON.stringify({}),
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("oav-fastify integration: Fastify specifics", () => {
  let app: FastifyInstance;
  const captured: Error[] = [];

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    app = Fastify();
    app.addHook(
      "preValidation",
      validateRequests(validator, {
        toHttpRequest: () => {
          // Fastify is async-native: thrown errors propagate via the
          // promise chain to Fastify's setErrorHandler without explicit
          // try/catch in our hook.
          throw new Error("extractor exploded");
        },
      }),
    );
    app.setErrorHandler((err: Error, _request, reply) => {
      captured.push(err);
      reply.code(500).send({ error: err.message });
    });
    app.post("/pets", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("thrown extractor errors propagate to Fastify's setErrorHandler via the promise chain", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/pets",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      payload: JSON.stringify({ name: "Fido" }),
    });
    expect(r.statusCode).toBe(500);
    const body = r.json() as { error: string };
    expect(body.error).toBe("extractor exploded");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toBe("extractor exploded");
  });
});
