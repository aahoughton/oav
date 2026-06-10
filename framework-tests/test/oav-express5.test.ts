import { type OpenAPIDocument } from "@oav/core";
import {
  httpRequestFromExpress,
  renderProblemDetails,
  ResponseValidationError,
  validateRequests,
  validateResponses,
} from "@oav/oav-express5";
import { createValidator } from "@oav/validator";
import express, { type Express, type Request } from "express-5";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-server integration tests against Express 5. Same scenario
 * names as oav-express4's integration suite (cross-adapter test
 * parity is part of the contract); the implementations differ only
 * where Express 5's promise-native middleware diverges from
 * Express 4's sync model.
 *
 * `express-5` is an npm alias for express@5 (see this directory's
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

describe("oav-express5 integration: default validateRequests", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    app.use(validateRequests(validator));
    app.post("/pets", (_req, res) => {
      res.json({ ok: true, kind: "post" });
    });
    app.get("/pets", (_req, res) => {
      res.json({ ok: true, kind: "get" });
    });
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
      body: JSON.stringify({}),
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
      headers: { "content-type": "application/json" },
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

describe("oav-express5 integration: custom onError", () => {
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
    app.post("/pets", (_req, res) => {
      res.json({ ok: true });
    });
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("custom onError runs and writes a custom envelope; handler not reached", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(422);
    const body = (await r.json()) as { kind: string };
    expect(body.kind).toBe("custom-envelope");
  });
});

describe("oav-express5 integration: async onError", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    app.use(
      validateRequests(validator, {
        onError: async (err, ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          renderProblemDetails(err, ctx);
        },
      }),
    );
    app.post("/pets", (_req, res) => {
      res.json({ ok: true });
    });
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
    expect(r.status).toBe(400);
    const body = (await r.json()) as { title: string };
    expect(body.title).toBe("Validation failed");
  });
});

describe("oav-express5 integration: custom toHttpRequest", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(petSpec());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Request & { verifiedBody?: unknown }).verifiedBody = { name: "Fido" };
      next();
    });
    app.use(
      validateRequests(validator, {
        toHttpRequest: (req: Request) => {
          const httpReq = httpRequestFromExpress(req);
          const fancy = (req as Request & { verifiedBody?: unknown }).verifiedBody;
          if (fancy !== undefined) httpReq.body = fancy;
          return httpReq;
        },
      }),
    );
    app.post("/pets", (_req, res) => {
      res.json({ ok: true });
    });
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("custom toHttpRequest extractor reaches the validator", async () => {
    const r = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant": "acme" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(200);
  });
});

function widgetSpec(): OpenAPIDocument {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths: {
      "/widgets/{id}": {
        get: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id"],
                    properties: { id: { type: "string" } },
                    additionalProperties: false,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

describe("oav-express5 integration: default validateResponses", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(widgetSpec());
    const app = express();
    app.use(validateResponses(validator));
    app.get("/widgets/:id", (req, res) => {
      if (req.params.id === "bad") return res.json({ id: 123 }); // id must be a string
      if (req.params.id === "teapot") return res.status(418).json({ id: "ok" }); // undeclared status
      return res.json({ id: req.params.id });
    });
    app.use(((err: Error, _req, res, next) => {
      if (err instanceof ResponseValidationError) {
        res.status(err.statusCode).json({ responseInvalid: true, count: err.errors.length });
        return;
      }
      void next;
    }) as express.ErrorRequestHandler);
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("a valid response body passes through unchanged", async () => {
    const r = await fetch(`${baseUrl}/widgets/ok`);
    expect(r.status).toBe(200);
    expect((await r.json()) as unknown).toEqual({ id: "ok" });
  });

  it("an invalid response body forwards a 500 to the host error handler", async () => {
    const r = await fetch(`${baseUrl}/widgets/bad`);
    expect(r.status).toBe(500);
    const body = (await r.json()) as { responseInvalid: boolean; count: number };
    expect(body.responseInvalid).toBe(true);
    expect(body.count).toBeGreaterThan(0);
  });

  it("an undeclared response status is a finding (500)", async () => {
    const r = await fetch(`${baseUrl}/widgets/teapot`);
    expect(r.status).toBe(500);
  });
});

describe("oav-express5 integration: validateResponses log-and-continue", () => {
  let server: Server;
  let baseUrl: string;
  const logged: number[] = [];

  beforeAll(async () => {
    const validator = createValidator(widgetSpec());
    const app = express();
    app.use(
      validateResponses(validator, {
        // Log the finding and return; the adapter sends the original
        // (invalid) body unchanged.
        onError: (errors) => {
          logged.push(errors.length);
        },
      }),
    );
    app.get("/widgets/:id", (_req, res) => res.json({ id: 123 }));
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("custom onError can record the finding and still send the body", async () => {
    const r = await fetch(`${baseUrl}/widgets/anything`);
    expect(r.status).toBe(200);
    expect((await r.json()) as unknown).toEqual({ id: 123 });
    expect(logged.length).toBe(1);
    expect(logged[0]).toBeGreaterThan(0);
  });
});

describe("oav-express5 integration: validateResponses double mount", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const validator = createValidator(widgetSpec());
    const app = express();
    app.use(validateResponses(validator));
    app.use(validateResponses(validator)); // configuration error
    app.get("/widgets/:id", (_req, res) => res.json({ id: "ok" }));
    app.use(((err: Error, _req, res, next) => {
      // Respond through the unwrapped res.end: the first mount's wrapper
      // is still active and would treat this 500 (undeclared in the
      // spec) as a finding of its own.
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: err.message }));
      void next;
    }) as express.ErrorRequestHandler);
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("the second mount fails the request with a clear error", async () => {
    const r = await fetch(`${baseUrl}/widgets/ok`);
    expect(r.status).toBe(500);
    const body = (await r.json()) as { error: string };
    expect(body.error).toMatch(/mounted twice/);
  });
});

describe("oav-express5 integration: Express 5 specifics", () => {
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
          // Express 5 awaits returned promises; a thrown error propagates
          // through the promise chain to the error middleware below
          // without explicit try/catch in our middleware.
          throw new Error("extractor exploded");
        },
      }),
    );
    app.use(((err: Error, _req, res, next) => {
      captured.push(err);
      res.status(500).json({ error: err.message });
      void next;
    }) as express.ErrorRequestHandler);
    ({ server, baseUrl } = await listenOnZero(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("thrown extractor errors propagate to the host's error middleware via Express 5's promise chain", async () => {
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
