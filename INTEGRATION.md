# Integration guide

`oav` is a validator, not a middleware package. You write a short
adapter between your HTTP framework and `validateRequest` /
`validateResponse`. This document is everything you need for the
adapter layer: framework snippets, recipes for the features `oav`
doesn't wrap (file upload, auth, response checking, status-code
mapping), and a migration path from `express-openapi-validator`.

## The honest summary

Using `express-openapi-validator` is a one-liner:

```ts
app.use(OpenApiValidator.middleware({ apiSpec, fileUploader: true, validateSecurity: {...} }));
```

Using `oav` is a ~20-line middleware plus your own multer / auth
wiring where needed. The cost is real. The payoff:

- **You own the error → HTTP mapping.** No magic status codes in
  library code, no `BadRequest`/`Unauthorized` classes you have to
  reverse-engineer. A small switch statement maps our stable `code`
  field to whatever status codes your API contract requires.
- **No monkey-patching of `res.json`.** `express-openapi-validator`
  wraps the response methods to auto-intercept. `oav` touches nothing
  on `req` or `res`. You call `validateResponse` where you want it,
  or not at all.
- **Structured error trees.** Every error is
  `{ code, path, message, params, children }`. Downstream code
  narrows on fields — `err.code === "required"` + `err.params.missing`
  — rather than parsing message strings.
- **Native OpenAPI 3.0 semantics.** `nullable: true`, boolean
  `exclusiveMaximum`, and `$ref`-suppresses-siblings work by 3.0
  rules. Most ajv-based validators retrofit these via 2020-12
  translation and lose edges in the conversion. The
  [conformance report](./conformance/REPORT.md) covers where we match
  the upstream suites and where we don't.
- **First-class overlays.** Extend an externally-owned base spec
  (Supabase, Hasura, PocketBase, a gateway-published document) with
  `applyOverlays` at load time. No forking, no pre-processing, no
  string substitution.

If you want "install, point at `spec.yaml`, done", use
`express-openapi-validator`. If you want explicit control over when
and where validation runs plus a typed error model you can narrow
against, keep reading.

## What the validator expects

`validateRequest` / `validateResponse` take a framework-agnostic
shape. The adapter's job is extracting these fields from your
framework's own request object:

```ts
interface HttpRequest {
  method: string; // uppercase verb
  path: string; // pathname only, no query
  query?: Record<string, string | string[]>;
  headers?: Record<string, string | string[]>; // lowercased keys
  contentType?: string; // may carry "; charset=utf-8"
  body?: unknown; // already-parsed
  cookies?: Record<string, string>;
}

interface HttpResponse {
  status: number;
  contentType?: string;
  headers?: Record<string, string | string[]>;
  body?: unknown;
}
```

Both methods return `null` on success or a `ValidationError` tree on
failure. The top-level node's `code` is `"request"` or `"response"`;
children hang off `body`, `query.<name>`, `headers.<name>`, etc.

## Framework adapters

### Express 5

Express 5 is promise-native: async middleware that throws routes to
the error handler automatically.

```ts
import { toProblemDetails } from "@aahoughton/oav";

app.use(async (req, res, next) => {
  const err = validator.validateRequest({
    method: req.method,
    path: req.path,
    query: req.query as Record<string, string | string[]>,
    headers: req.headers as Record<string, string | string[]>,
    contentType: req.get("content-type") ?? undefined,
    body: req.body,
    cookies: req.cookies,
  });
  if (err === null) return next();
  res
    .status(httpStatusFor(err))
    .type("application/problem+json")
    .json(toProblemDetails(err, { instance: req.originalUrl }));
});
```

Requires `express.json()` registered before this middleware (and
`cookie-parser` if you use the `cookies` field). `httpStatusFor`
is the one-line mapping function from the
[status-code mapping recipe](#status-code-mapping).

### Express 4

The `req` surface is identical. The difference: Express 4 doesn't
await returned promises, so uncaught async errors don't propagate.
Use `try`/`catch`:

```ts
app.use((req, res, next) => {
  try {
    const err = validator.validateRequest(/* same as Express 5 */);
    if (err === null) return next();
    res
      .status(httpStatusFor(err))
      .type("application/problem+json")
      .json(toProblemDetails(err, { instance: req.originalUrl }));
  } catch (e) {
    next(e);
  }
});
```

### Fastify

Register as a `preValidation` hook so it runs after Fastify's own
body parsing but before the route handler.

```ts
fastify.addHook("preValidation", async (request, reply) => {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const err = validator.validateRequest({
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: request.headers as Record<string, string | string[]>,
    contentType: request.headers["content-type"],
    body: request.body,
  });
  if (err !== null) {
    return reply
      .code(httpStatusFor(err))
      .type("application/problem+json")
      .send(toProblemDetails(err, { instance: request.url }));
  }
});
```

Fastify parses JSON bodies automatically; for other formats register
the appropriate content-type parser (`@fastify/formbody`, etc.)
ahead of the hook.

### Next.js (App Router), Hono, Bun, Deno

These frameworks expose a Web Standards `Request` per route, and there
is no middleware chain to hang a one-time adapter off. Use
`validator.validateFetchRequest` directly in each route handler. It
reads `request.url`, `request.headers`, and the body (dispatching on
`Content-Type`: JSON, `*+json`, URL-encoded, multipart, text, or raw
bytes) and returns a discriminated union.

```ts
// app/pets/route.ts
import { toProblemDetails } from "@aahoughton/oav";
import { validator } from "@/lib/validator";
import { httpStatusFor } from "@/lib/status";

type CreatePet = { name: string; tag?: string };

export async function POST(request: Request) {
  const result = await validator.validateFetchRequest<CreatePet>(request);
  if (!result.ok) {
    return Response.json(toProblemDetails(result.error, { instance: request.url }), {
      status: httpStatusFor(result.error),
      headers: { "Content-Type": "application/problem+json" },
    });
  }
  const { body } = result; // typed as CreatePet
  // ...handler logic
  return Response.json({ id: createPet(body) }, { status: 201 });
}
```

Three things to know:

- **Body is consumed.** `Request.body` is a one-shot stream;
  `validateFetchRequest` reads it. If you need the original bytes,
  `request.clone()` first.
- **Typed body narrows via the generic, not runtime inference.** The
  validator has just confirmed the body matches the spec's schema, so
  the cast is safe for a handler using the same schema. If you change
  the spec, update the generic.
- **Repeated query keys.** `validateFetchRequest` collapses
  `?ids=1&ids=2` into `query.ids = ["1", "2"]`. Single values stay
  strings.

**Next.js-specific note.** The top-level `middleware.ts` runs on the
Edge runtime and doesn't know which route matched yet. Validate
inside the route handler, not in `middleware.ts`.

**Fully bespoke body handling.** If the built-in body parsing doesn't
fit (e.g. you want to stream-process a large JSON payload or handle
an unusual content type), use the lower-level primitive:

```ts
import { httpRequestFromFetch } from "@aahoughton/oav";

const { httpRequest } = await httpRequestFromFetch(request);
// Mutate httpRequest.body however you need, then:
const err = validator.validateRequest(httpRequest);
```

Hono has `.use()` middleware and can use the Express-style adapter
above if you prefer a single registration point. The per-route
`validateFetchRequest` still wins on generic-driven body typing.

**Validating upstream responses.** The symmetric method
`validateFetchResponse(request, response)` runs the response side of
validation against a Web Standards `Response`. The `request` is used
only to match the operation (method + path); its body is not read.

```ts
const request = new Request(upstreamUrl);
const response = await fetch(request);
const result = await validator.validateFetchResponse<PetList>(request, response);
if (!result.ok) {
  log.warn("upstream returned a response the spec doesn't declare", result.error);
}
// result.body is the parsed response body, typed as PetList on success.
```

Useful for contract-testing a service integration, or for catching
spec drift when an upstream changes its response shape without
updating the document.

## Recipes

### Status-code mapping

`ValidationError.code` is stable and small. Most users can get by
with this:

```ts
import type { ValidationError } from "@aahoughton/oav";

function httpStatusFor(err: ValidationError): number {
  switch (err.code) {
    case "route":
      return 404; // no matching method + path
    case "content-type":
      return 415; // request Content-Type not declared
    case "status":
      return 500; // response-side: spec doesn't declare this status
    default:
      return 400; // schema violation, missing required, etc.
  }
}
```

`express-openapi-validator` distinguishes 404 (no path) from 405
(path exists, wrong method). `oav` emits `code: "route"` for both.
If you need 405 specifically, do a method-agnostic path check
yourself:

```ts
// Pseudocode: if the path matches ANY route at a different method, return 405.
// oav's router doesn't expose this directly yet; a simple regex pass over
// your own spec's path templates gets you there in ~10 lines.
```

For richer response envelopes, `toProblemDetails` produces
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)
`application/problem+json` with the failing leaves as an `issues`
extension member. `collectIssues` is the raw flat leaf list if you
want to roll your own response shape.

### File uploads with multer

`express-openapi-validator` bundles `multer`. `oav` does not: install
multer yourself, run it before the validator, and reconstruct the
body for the validator call.

```ts
import multer from "multer";
import { createValidator, toProblemDetails } from "@aahoughton/oav";

const upload = multer({ storage: multer.memoryStorage() });

app.post("/avatar", upload.any(), async (req, res, next) => {
  // multer populates req.body with text fields and req.files with the files.
  // Reassemble into the spec's body shape.
  const files = Object.fromEntries(
    ((req.files as Express.Multer.File[]) ?? []).map((f) => [f.fieldname, f.buffer]),
  );
  const err = validator.validateRequest({
    method: req.method,
    path: req.path,
    contentType: req.get("content-type"),
    headers: req.headers as Record<string, string | string[]>,
    body: { ...req.body, ...files },
  });
  if (err !== null) {
    return res
      .status(httpStatusFor(err))
      .type("application/problem+json")
      .json(toProblemDetails(err, { instance: req.originalUrl }));
  }
  // handler uses req.body + req.files as normal
});
```

The validator already handles the body-type mismatch you'd otherwise
hit: a `{ type: "string", format: "binary" }` field in the spec is
rewritten to an "accept anything" schema before compile, so a Buffer
or Uint8Array passes without a string-type error. `format: "byte"`
(base64) still validates as a string.

### Response validation (no monkey-patching)

`express-openapi-validator` wraps `res.json` and `res.send` so it can
inspect response bodies the handler returns. `oav` doesn't. Options:

**Per-route explicit.** Validate before sending. Clear, easy to
reason about, zero surprises:

```ts
app.get("/pets/:id", async (req, res) => {
  const pet = await db.pets.find(req.params.id);
  const body = pet ?? { error: "not found" };
  const status = pet ? 200 : 404;

  const err = validator.validateResponse(
    { method: req.method, path: req.path },
    { status, contentType: "application/json", body },
  );
  if (err !== null) {
    // In prod: log + return a generic 500.
    // In dev: return the tree so you notice.
    console.error(err);
  }
  res.status(status).json(body);
});
```

**Per-app wrapper.** Wrap `res.json` yourself if you want the
auto-interception behaviour. Keep it local so it's readable:

```ts
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    const err = validator.validateResponse(
      { method: req.method, path: req.path },
      { status: res.statusCode, contentType: "application/json", body },
    );
    if (err !== null) {
      // Decide your policy: log-only, add a header, hard fail, etc.
      res.setHeader("X-Response-Validation", "failed");
      console.warn("response validation failed", err);
    }
    return json(body);
  };
  next();
});
```

The `res.json` wrapper is ~15 lines; ship exactly the policy you
want rather than whatever `onError` shape a library decided on.

### Security / authentication

`oav` has no `securityHandlers` option and does not interpret
`components.securitySchemes`. Run your auth middleware first and
treat auth as orthogonal to schema validation:

```ts
app.use(authenticateJwt); // your own middleware
app.use(oavMiddleware); // validates schema against the authenticated request
```

`express-openapi-validator`'s `securityHandlers` is structurally
limited anyway: it still expects you to supply the auth function per
scheme. The only thing it gives you is a declarative dispatch table
driven by the `security:` blocks in your spec. If that's load-bearing
for you, write a 30-line dispatcher that walks the matched
operation's `security` array and calls your per-scheme handlers. It's
mechanical work that's easier to own than debug.

### Type coercion on body fields

Neither validator coerces `{"age": "42"}` to `{"age": 42}` on request
bodies by default; `express-openapi-validator` has
`validateRequests.coerceTypes` for this, `oav` doesn't.

Query parameters are different: `oav` auto-coerces scalar query
params per their declared type (`type: integer` → `Number(raw)`,
`type: boolean` → `true`/`false`). Only bodies are strict.

If you need loose body coercion, do it in a pre-middleware:

```ts
app.use(
  express.json({
    reviver: (key, value) => {
      /* your coercion */ return value;
    },
  }),
);
```

Or fix the client. The stricter surface catches real bugs that
`coerceTypes: true` masks.

### Ignoring paths not in the spec

```ts
app.use(async (req, res, next) => {
  const err = validator.validateRequest({
    /* ... */
  });
  if (err === null) return next();
  if (err.code === "route") return next(); // unvalidated path, let routing continue
  // ... 4xx response as usual
});
```

This is the equivalent of `express-openapi-validator`'s
`ignoreUndocumented: true`. For regex-based exclusions, short-circuit
before calling the validator.

## Migration from express-openapi-validator

### Option map

| `express-openapi-validator` option      | `oav` equivalent                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apiSpec` (path/URL/object)             | `loadSpec({ reader, entry })` + `createValidator(doc)`                                                          |
| `validateRequests: true`                | `validator.validateRequest(...)` in your middleware                                                             |
| `validateResponses: true`               | `validator.validateResponse(...)` in handler or a `res.json` wrapper (see recipes)                              |
| `validateRequests.allErrors`            | Default — `oav` always collects every leaf. Bound cost with `maxErrors: N`.                                     |
| `validateRequests.coerceTypes`          | Query scalars coerced by default; body coercion not supported.                                                  |
| `validateRequests.removeAdditional`     | Not supported. `additionalProperties: false` rejects; there is no silent-drop mode.                             |
| `validateRequests.discriminator`        | Native, always on for OpenAPI specs.                                                                            |
| `formats`                               | `createValidator(spec, { formats: { ... } })`. Built-ins from `@aahoughton/oav/formats`.                        |
| `validateFormats: "fast" \| "full"`     | N/A — single-pass validation; the built-in formats are RFC-sourced.                                             |
| `ajvFormats`                            | Pass custom format functions via the `formats` option.                                                          |
| `serDes`                                | Not supported. Pre- or post-transform the payload in your handler if you need `Date` / `ObjectId` / etc.        |
| `validateSecurity.handlers`             | Your own auth middleware, run before the validator.                                                             |
| `fileUploader: true`                    | Your own multer middleware (see [recipe](#file-uploads-with-multer)).                                           |
| `operationHandlers`                     | Your own Express routes. `oav` doesn't auto-load handlers from the filesystem.                                  |
| `ignorePaths` (regex/fn)                | Short-circuit in your middleware before calling `validateRequest`.                                              |
| `ignoreUndocumented`                    | `if (err.code === "route") return next()`.                                                                      |
| `$refParser: "bundle" \| "dereference"` | `loadSpec` inlines external refs; circulars become internal refs. Use `resolveSpec` directly for finer control. |
| `validateApiSpec`                       | Run `oav resolve spec.yaml` in CI; no runtime toggle.                                                           |

### What you're giving up

- **Auto-multer.** Replace with ~15 lines per upload route.
- **Security handler dispatch.** Use your existing auth middleware.
- **`operationHandlers` filesystem routing.** Write Express routes
  manually or keep whatever routing you had.
- **`res.json` monkey-patching for auto-response-validation.** Call
  `validateResponse` explicitly where you need it, or wrap `res.json`
  yourself (15 lines; see recipe).
- **`serDes` payload mutations.** Do these in your handler, not the
  validator.
- **Typed error classes** (`BadRequest`, `Unauthorized`, etc.). Use
  the error's `code` field and the status-code map above.

### What you're getting

- **Structured error tree** with stable `code`s, segment paths, and
  per-code `params` typed via `BuiltInErrorParams`. Type-narrow
  rather than pattern-match message strings.
- **Native 3.0 dialect**, not a 2020-12 rewrite. See
  [conformance/REPORT.md](./conformance/REPORT.md) for the cases we
  pass and the short list we don't.
- **Overlays** for extending externally-owned specs — a first-class
  feature, not a forking workaround.
- **Smaller install footprint.** No `ajv`, no `multer`, no
  `ajv-formats`. Single runtime dep (`yaml`) plus an optional peer
  (`commander`, CLI only).
- **No mutation of `req` in place.**
  `express-openapi-validator` attaches `req.openapi`, coerces types,
  and replaces `req.body` after deserialize. `oav` reads its inputs
  and returns an error tree. Your request object is untouched.
- **Explicit control over where validation runs.** Skip it on some
  routes without configuration gymnastics; run it twice (per-request
  and per-response) with different `maxErrors` budgets; run it at
  the edge of a queue processor outside any HTTP framework.

### Behavior differences to watch for

- **404 vs 405.** `express-openapi-validator` returns 405 when the
  path exists but the method doesn't. `oav` emits `code: "route"`
  for both cases. Add a method-agnostic path check if you need 405
  specifically.
- **Response body interception.** `express-openapi-validator` catches
  `res.send("{...}")` (string form) too via its wrappers. `oav` does
  not unless you write the wrapper yourself, in which case parse
  before validating.
- **Error paths.** `oav` recently dropped the redundant `"response"`
  prefix from response-side leaf paths. A body-validation failure on
  a response is now at `["body", ...]`, not `["response", "body", ...]`.
  Discriminate the leg via the top-level `err.code` (`"request"` vs
  `"response"`), not `path[0]`.
- **Optional `openapi` version fallback.** If the spec's `openapi`
  field is missing or unsupported, `oav` silently uses 3.1 by default
  (see `onUnknownVersion`). `express-openapi-validator` throws.
- **Formats.** Both libraries treat `format` as assertive in an
  OpenAPI context. Under the raw `jsonSchemaDialect`, `oav` treats it
  as annotation-only per the 2020-12 default — a deliberate choice,
  configurable via the assertion vocabulary.
