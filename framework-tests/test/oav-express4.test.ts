import { type OpenAPIDocument } from "@oav/core";
import { httpRequestFromExpress, renderProblemDetails, validateRequests } from "@oav/oav-express4";
import { createValidator } from "@oav/validator";
import express, { type Express, type Request } from "express-4";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-server integration tests. Spin up Express 4 on a random port,
 * round-trip via native fetch, close the server when done.
 *
 * Same `it()` names as the sibling oav-express5 / oav-fastify
 * integration suites; adapter implementations differ, scenarios
 * stay identical.
 *
 * `express-4` is an npm alias for express@4 (see this directory's
 * package.json). End users `import express from "express"`; the alias
 * exists only so both express majors can be installed side-by-side
 * in one isolated sub-package.
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

async function listenOnZero(app: Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("oav-express4 integration: default validateRequests", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    app.use(validateRequests(validator));
    app.post("/pets", (_req, res) => res.json({ ok: true, kind: "post" }));
    app.get("/pets", (_req, res) => res.json({ ok: true, kind: "get" }));
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("valid request reaches the handler", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({ name: "Fido" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; kind: string };
    expect(body).toEqual({ ok: true, kind: "post" });
  });

  it("invalid request returns 400 problem+details", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({}), // missing required `name`
    });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toMatch(/application\/problem\+json/);
    const body = (await r.json()) as { title: string; issues: unknown[] };
    expect(body.title).toBe("Validation failed");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("wrong verb returns 405 with Allow header", async () => {
    const r = await fetch(`${baseUrl}/pets`, { method: "DELETE" });
    expect(r.status).toBe(405);
    const allow = r.headers.get("allow") ?? "";
    expect(allow).toMatch(/POST/);
    expect(allow).toMatch(/GET/);
  });

  it("unknown path returns 404", async () => {
    const r = await fetch(`${baseUrl}/nope`, { method: "GET" });
    expect(r.status).toBe(404);
  });

  it("missing required header returns 400 problem+details", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // no x-tenant
      body: JSON.stringify({ name: "Fido" }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { issues: Array<{ code: string }> };
    expect(body.issues.some((i) => i.code === "header-param")).toBe(true);
  });

  it("unmatched Content-Type returns 415", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-tenant": "acme" },
      body: "not json",
    });
    expect(r.status).toBe(415);
  });
});

describe("oav-express4 integration: custom onError", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    app.use(
      validateRequests(validator, {
        onError: (_err, ctx) => {
          ctx.res.status(422).json({ kind: "custom-envelope" });
        },
      }),
    );
    app.post("/pets", (_req, res) => res.json({ ok: true }));
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("custom onError runs and writes a custom envelope; handler not reached", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({}), // invalid
    });
    expect(r.status).toBe(422);
    const body = (await r.json()) as { kind: string };
    expect(body.kind).toBe("custom-envelope");
  });
});

describe("oav-express4 integration: async onError", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    app.use(
      validateRequests(validator, {
        onError: async (err, ctx) => {
          // Simulate async work (remote logging, dynamic config) before responding.
          await new Promise((resolve) => setTimeout(resolve, 5));
          renderProblemDetails(err, ctx);
        },
      }),
    );
    app.post("/pets", (_req, res) => res.json({ ok: true }));
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("async onError is awaited before the response settles", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({}),
    });
    // The await inside onError must complete before the response lands.
    expect(r.status).toBe(400);
    const body = (await r.json()) as { title: string };
    expect(body.title).toBe("Validation failed");
  });
});

describe("oav-express4 integration: custom toHttpRequest", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    // Inject a synthetic verifiedBody for every request; must run
    // BEFORE validateRequests so the extractor sees it.
    app.use((req, _res, next) => {
      (req as Request & { verifiedBody?: unknown }).verifiedBody = { name: "Fido" };
      next();
    });
    app.use(
      validateRequests(validator, {
        toHttpRequest: (req: Request) => {
          // Pretend the body lives on a custom field upstream wrote.
          const httpReq = httpRequestFromExpress(req);
          const fancy = (req as Request & { verifiedBody?: unknown }).verifiedBody;
          if (fancy !== undefined) httpReq.body = fancy;
          return httpReq;
        },
      }),
    );
    app.post("/pets", (req, res) => res.json({ ok: true, sawHeader: req.get("x-tenant") }));
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("custom toHttpRequest extractor reaches the validator", async () => {
    // Real body is empty, but verifiedBody contains a valid body; the
    // custom extractor should surface it to the validator and validation
    // should pass.
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({}), // would fail without the extractor swap
    });
    expect(r.status).toBe(200);
  });
});

describe("oav-express4 integration: Express 4 specifics", () => {
  let server: Server;
  let baseUrl: string;
  const captured: Error[] = [];

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    app.use(
      validateRequests(validator, {
        toHttpRequest: () => {
          // Simulate a sync extractor failure; Express 4 requires
          // try/catch + next(err) since it doesn't await middleware
          // promises. The adapter handles this for us.
          throw new Error("extractor exploded");
        },
      }),
    );
    // Express error middleware to verify the error reached the chain.
    app.use(((err: Error, _req, res, next) => {
      captured.push(err);
      res.status(500).json({ error: err.message });
      void next; // unused but signature requires 4 args
    }) as express.ErrorRequestHandler);
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("sync extractor throw is forwarded via next(err) to the host's error middleware", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({ name: "Fido" }),
    });
    expect(r.status).toBe(500);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("extractor exploded");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toBe("extractor exploded");
  });
});
