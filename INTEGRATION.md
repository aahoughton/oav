# Integration guide

`oav` is a validator, not a middleware package. You write a short
adapter between your HTTP framework and `validateRequest` /
`validateResponse`. This document is everything you need for the
adapter layer: framework snippets, recipes for the features `oav`
doesn't wrap (file upload, auth, response checking, status-code
mapping), and a migration path from `express-openapi-validator`.

## What the two libraries take on

`express-openapi-validator` registers as one middleware:

```ts
app.use(OpenApiValidator.middleware({ apiSpec, fileUploader: true, validateSecurity: {...} }));
```

`oav` is a ~20-line middleware plus your own multer / auth wiring
where needed. In exchange:

- **You own the error → HTTP mapping.** A small switch statement maps
  the validator's stable `code` field to whatever status codes your
  API contract requires.
- **No wrapping of `res.json`.** `express-openapi-validator` wraps
  the response methods to auto-intercept. `oav` reads its arguments
  and returns a result; it does not touch `req` or `res`. Response
  validation happens when you call `validateResponse`.
- **Structured error trees.** Every error is
  `{ code, path, message, params, children }`. Downstream code can
  narrow on fields (`err.code === "required"`,
  `err.params.missing`) instead of parsing message strings.
- **Built-in OpenAPI 3.0 dialect.** `nullable: true`, boolean
  `exclusiveMaximum`, and `$ref`-suppresses-siblings are in the
  compiler's dialect dispatch — no preprocessing step. See the
  [conformance report](./conformance/REPORT.md) for pass / fail
  counts by category.
- **Overlays.** Extend an externally-owned base spec (Supabase,
  Hasura, PocketBase, a gateway-published document) with
  `applyOverlays` at load time. See [OVERLAYS.md](./OVERLAYS.md).

For a single-line middleware registration, use
`express-openapi-validator`. For explicit control over when and where
validation runs and a typed error model to narrow against, keep
reading.

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

## Supporting helpers used below

Both shipped from `@aahoughton/oav`:

- **`httpStatusFor(err, overrides?)`** — maps a `ValidationError`
  tree to an HTTP status: `route` → 404, `method` → 405, `security`
  (leaf) → 401, `content-type` (leaf) → 415, `status` (leaf) → 500,
  everything else → 400. Pass `{ default: 422 }` (or any other key)
  to override a slot. The helper inspects the tree correctly —
  writing this switch by hand is a common mistake, because
  `"content-type"` / `"security"` / `"status"` appear as leaves
  under a top-level `"request"` / `"response"` branch, not as
  `err.code` directly.

- **`allowHeaderFor(err)`** — returns the `Allow` header value for a
  405 (RFC 9110 §15.5.6 requires it) or `undefined` otherwise.

- **`toProblemDetails(err, opts?)`** — renders the error tree as an
  [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)
  `application/problem+json` body with the failing leaves carried in
  an `issues` field (a non-standard field alongside the required
  ones).

```ts
import { allowHeaderFor, httpStatusFor, toProblemDetails } from "@aahoughton/oav";
```

The adapters below assume all three are in scope.

## Framework adapters

### Express 5

Express 5 is promise-native: async middleware that throws routes to
the error handler automatically.

```ts
import { allowHeaderFor, httpStatusFor, toProblemDetails } from "@aahoughton/oav";

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
  const allow = allowHeaderFor(err);
  if (allow !== undefined) res.setHeader("Allow", allow);
  res
    .status(httpStatusFor(err))
    .type("application/problem+json")
    .json(toProblemDetails(err, { instance: req.originalUrl }));
});
```

Requires `express.json()` registered before this middleware (and
`cookie-parser` if you use the `cookies` field).

**Two known sharp edges with stock `express.json()`:**

1. **`express.json()` only parses JSON content-types.** If a client
   sends `Content-Type: text/plain` (or anything else your spec
   doesn't declare), `req.body` is left empty and oav reports
   "missing required request body" rather than a 415. To get
   accurate 415 responses, register `express.raw({ type: '*/*' })`
   on the non-JSON content types you want oav to gate, or parse
   the body yourself in middleware and hand it to `validateRequest`.
2. **Malformed JSON throws before oav runs.** `express.json()`
   throws a `SyntaxError` on bad JSON, and Express's default error
   handler emits an HTML page. Install an Express error middleware
   to convert it to `application/problem+json` upstream of the
   validator.

### Express 4

The `req` surface is identical. The difference: Express 4 doesn't
await returned promises, so uncaught async errors don't propagate.
Use `try`/`catch`:

```ts
app.use((req, res, next) => {
  try {
    const err = validator.validateRequest(/* same as Express 5 */);
    if (err === null) return next();
    const allow = allowHeaderFor(err);
    if (allow !== undefined) res.setHeader("Allow", allow);
    res
      .status(httpStatusFor(err))
      .type("application/problem+json")
      .json(toProblemDetails(err, { instance: req.originalUrl }));
  } catch (e) {
    next(e);
  }
});
```

The same two body-parser caveats apply as for Express 5.

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
    const allow = allowHeaderFor(err);
    if (allow !== undefined) reply.header("Allow", allow);
    return reply
      .code(httpStatusFor(err))
      .type("application/problem+json")
      .send(toProblemDetails(err, { instance: request.url }));
  }
});
```

Fastify parses JSON bodies automatically; for other formats register
the appropriate content-type parser (`@fastify/formbody`, etc.)
ahead of the hook. Fastify's own JSON-parse-error response (shape:
`{ statusCode, code: "FST_ERR_CTP_INVALID_JSON_BODY", ... }`) fires
before `preValidation` runs; register `fastify.setErrorHandler` if
you want `application/problem+json` for those too.

### Next.js (App Router), Hono, Bun, Deno

These frameworks dispatch to Web Standards `Request` handlers per
route. Each also has a cross-cutting hook — Next.js's `proxy.ts`
(renamed from `middleware.ts` in Next 16; both still work), Hono's
`app.use('*', ...)`, Bun / Deno framework-specific hooks — so you
can pick. Use per-route when you want the `<Body>` generic to flow
into the typed success branch; use the cross-cutting hook when you'd
rather register the adapter once.

Per-route form with `validator.validateFetchRequest<T>`. It reads
`request.url`, `request.headers`, and the body (dispatching on
`Content-Type`: JSON, `*+json`, URL-encoded, multipart, text, or raw
bytes) and returns a discriminated union.

```ts
// app/pets/route.ts
import { allowHeaderFor, httpStatusFor, toProblemDetails } from "@aahoughton/oav";
import { validator } from "@/lib/validator";

type CreatePet = { name: string; tag?: string };

export async function POST(request: Request) {
  const result = await validator.validateFetchRequest<CreatePet>(request);
  if (!result.ok) {
    const allow = allowHeaderFor(result.error);
    const headers: Record<string, string> = { "Content-Type": "application/problem+json" };
    if (allow !== undefined) headers["Allow"] = allow;
    return Response.json(toProblemDetails(result.error, { instance: request.url }), {
      status: httpStatusFor(result.error),
      headers,
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

**Next.js — cross-cutting alternative.** `proxy.ts` (or
`middleware.ts` on Next 15) runs on every request. Since Next 15
middleware supports the Node runtime and Next buffers the body,
you can put the adapter there instead:

```ts
// proxy.ts (Next 16+) / middleware.ts (Next 15)
import { allowHeaderFor, httpStatusFor, toProblemDetails } from "@aahoughton/oav";
import { NextResponse, type NextRequest } from "next/server";
import { validator } from "@/lib/validator";

export const config = {
  runtime: "nodejs",
  matcher: "/:path*",
};

export async function middleware(request: NextRequest) {
  const result = await validator.validateFetchRequest(request);
  if (result.ok) return NextResponse.next();
  const allow = allowHeaderFor(result.error);
  const headers: Record<string, string> = { "Content-Type": "application/problem+json" };
  if (allow !== undefined) headers["Allow"] = allow;
  return new NextResponse(
    JSON.stringify(toProblemDetails(result.error, { instance: request.url })),
    { status: httpStatusFor(result.error), headers },
  );
}
```

Pick one: per-route gives you `<T>`-typed bodies; the cross-cutting
hook gives you one-and-done registration but the handler doesn't see
a typed body (middleware and handler both read the request, and Next
clones between them — but the per-route handler can't know what the
middleware validated).

**Fully bespoke body handling.** If the built-in body parsing doesn't
fit (e.g. you want to stream-process a large JSON payload or handle
an unusual content type), use the lower-level primitive:

```ts
import { httpRequestFromFetch } from "@aahoughton/oav";

const { httpRequest } = await httpRequestFromFetch(request);
// Mutate httpRequest.body however you need, then:
const err = validator.validateRequest(httpRequest);
```

**Hono — cross-cutting alternative.** `app.use('*', mw)` can host
the adapter. Hono parallels the per-route Standard-Schema validator
pattern (`@hono/zod-validator` etc.), so per-route with a typed
`<T>` is the native idiom and `c.req.valid('json')` is the
community muscle memory; oav's `validateFetchRequest<T>` slots into
the same shape via `c.req.raw`.

**Hono gotcha**: `c.req.raw.body` is a one-shot stream. Don't run
`validateFetchRequest` in BOTH global middleware AND a per-route
handler on the same request — the handler's call sees a consumed
body and fails. Pick one. If using global middleware, stash the
validated body for handlers:

```ts
const app = new Hono<{ Variables: { validatedBody: unknown } }>();
app.use("*", async (c, next) => {
  const result = await validator.validateFetchRequest(c.req.raw);
  if (result.ok) {
    c.set("validatedBody", result.body);
    return next();
  }
  // ...problem+json response
});
app.post("/pets", (c) => {
  const body = c.get("validatedBody") as CreatePet;
  return c.json({ id: "pet_1", name: body.name }, 201);
});
```

**Bun / Deno.** Pick a framework (Hono, Elysia on Bun; Hono, Oak on
Deno) and use its hook idiom — same guidance as above, just under a
different name. For a raw `Bun.serve` / `Deno.serve` handler,
`validateFetchRequest` is the natural fit; there's no hook layer to
register against.

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

Use `httpStatusFor` from `@aahoughton/oav`:

```ts
import { httpStatusFor, toProblemDetails } from "@aahoughton/oav";

const err = validator.validateRequest(httpRequest);
if (err !== null) {
  res
    .status(httpStatusFor(err))
    .type("application/problem+json")
    .json(toProblemDetails(err, { instance: req.originalUrl }));
}
```

Default mapping:

| `err` shape                     | Status |
| ------------------------------- | ------ |
| top-level `code: "route"`       | 404    |
| top-level `code: "method"`      | 405    |
| any leaf `code: "security"`     | 401    |
| any leaf `code: "content-type"` | 415    |
| any leaf `code: "status"`       | 500    |
| otherwise                       | 400    |

Override any slot with the second argument — e.g. APIs that use 422
for schema errors:

```ts
httpStatusFor(err, { default: 422 });
```

Why not write the switch by hand? The obvious `switch (err.code)`
misses `content-type`, `security`, and `status` — those codes are
leaves under a top-level `"request"` / `"response"` wrapper, not the
top-level code itself. `httpStatusFor` handles the tree shape
correctly.

RFC 9110 requires the `Allow` response header on 405s. Use
`allowHeaderFor` to get the comma-joined value:

```ts
import { allowHeaderFor } from "@aahoughton/oav";

const allow = allowHeaderFor(err);
if (allow !== undefined) res.setHeader("Allow", allow);
```

For richer response envelopes, `toProblemDetails` produces
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)
`application/problem+json` with the failing leaves as an `issues`
field (a non-standard field alongside the required ones).
`collectIssues` is the raw flat leaf list if you want to roll your
own response shape.

### File uploads with multer

`express-openapi-validator` bundles `multer`. `oav` does not: install
multer yourself, run it before the validator, and reconstruct the
body for the validator call.

```ts
import multer from "multer";
import { createValidator, httpStatusFor, toProblemDetails } from "@aahoughton/oav";

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

### Deriving middleware config from the spec

Multer's `limits.fileSize` and the spec's `maxLength` on a
`format: binary` field are two copies of the same number. To keep
them from drifting, derive the middleware limit from the spec at
startup:

```ts
import multer from "multer";
import { createValidator } from "@aahoughton/oav";
import { digestOperation } from "./spec-digest"; // copied from examples/spec-digest.ts

const validator = createValidator(spec);

const info = validator.getOperation({ method: "POST", path: "/uploads" });
if (info === null) throw new Error("no matching operation for /uploads");

const digest = digestOperation(info.operation);
const maxBytes = digest.bodyLimits["multipart/form-data"]?.maxBytes;
if (maxBytes === undefined) {
  throw new Error("spec must declare `maxLength` on the upload's binary field");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes },
});

app.post("/uploads", upload.any() /* validator + handler as above */);
```

`getOperation` returns the resolved, overlay-applied
`OperationObject` for a (method, path) pair. It does the same
route-match + `$ref` resolution + overlay application that validation
does, but hands the result back as plain OpenAPI shapes — read
whatever declaration you need. `digestOperation` (see
[`examples/spec-digest.ts`](./examples/spec-digest.ts)) is a recipe
that pulls the common middleware-config facts into a flat shape:
content types, body limits, required headers, security. Copy it into
your project and adjust the interpretation choices
(`maxLength`-as-bytes vs code points, which `x-*` extensions to
recognise, etc.) to fit your domain.

The getter is startup-time introspection, not part of validation. Its
job is to make the spec the single source of truth for middleware
configuration — multer's `fileSize`, body-parser content types, auth
middleware assertions — so duplicated magic numbers can't drift
against the validator's own view.

### Streaming bodies, large uploads, and the `readBody` override

The built-in `validateFetchRequest` reads the entire request body into
memory to parse it. That suits typical JSON / form payloads but not
large uploads or streams you want to process incrementally. Two
options depending on how much of the fetch helper you want to keep:

**Option 1: `readBody` callback.** Pass a callback that consumes the
`Request` stream however you want and returns the body shape your
schema declares:

```ts
import { readBodyFromFetch } from "@aahoughton/oav";
import { parseMultipart } from "@mjackson/multipart-parser"; // or busboy, formidable, etc.

export async function POST(request: Request) {
  const result = await validator.validateFetchRequest<UploadBody>(request, {
    readBody: async (req) => {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.startsWith("multipart/form-data")) {
        // Stream the multipart body field-by-field; write file fields
        // to disk without buffering; return placeholders (paths) that
        // the spec's `format: binary` bypass accepts.
        const fields = await streamMultipartToDisk(req);
        return { caption: fields.caption, file: fields.file.tempPath };
      }
      // For every other content type, fall through to the default parser.
      return readBodyFromFetch(req);
    },
  });
  // ...
}
```

The callback owns the stream. The validator does not read
`request.body` when `readBody` is provided, so there is no
double-consumption.

**Option 2: assemble the `HttpRequest` yourself.** For routes where
`validateFetchRequest`'s convenience isn't worth even passing through
the helper, call `validator.validateRequest` directly with whatever
body shape you've already built:

```ts
const body = await myCustomStreamingPipeline(request);
const err = validator.validateRequest({
  method: request.method,
  path: new URL(request.url).pathname,
  contentType: request.headers.get("content-type") ?? undefined,
  body,
});
```

**Structural constraints require the whole value.** A schema that
declares object shape, required fields, array bounds, or `oneOf`
needs the full payload to validate. `validateRequest` accepts an
already-buffered 10 GB document; the memory cost is the caller's.
For spec-level opt-out, declare the body as `format: binary` and
let the opaque-body bypass accept whatever the HTTP layer decoded.

**No bundled multipart parser.** `busboy`, `formidable`, and
`@mjackson/multipart-parser` each make different tradeoffs, and
picking one forces every user onto that pick. `readBody` is the plug
point; bring whichever parser fits your stack.

### Response validation (no monkey-patching)

`express-openapi-validator` wraps `res.json` and `res.send` so it can
inspect response bodies the handler returns. `oav` doesn't. Options:

**Per-route explicit.** Validate before sending:

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

**Per-app wrapper.** Wrap `res.json` yourself if you want
auto-interception behaviour for every response:

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

The `res.json` wrapper is ~15 lines. The policy (log, header, hard
fail, etc.) is whatever you choose to put in the `if (err !== null)`
branch.

### Security / authentication

`oav` performs **shape-only** security validation: it confirms the
request carries the credential location declared by the spec (a
`Bearer` token in `Authorization`, the declared apiKey header / query
/ cookie, a base64 `Basic user:pass` pair), but it does **not** verify
the credential itself. That's your auth middleware's job; keep it
upstream of the validator.

```ts
app.use(authenticateJwt); // verifies tokens, populates req.user
app.use(oavMiddleware); // shape + schema checks
```

The shape check runs automatically against each operation's
`security:` (or document-level `security:` when the operation doesn't
override). Supported:

- `http` with `scheme: "bearer"` — requires `Authorization: Bearer <non-empty>`.
- `http` with `scheme: "basic"` — requires `Authorization: Basic <base64>`; the base64 must decode to a `user:pass` shape (no credential verification).
- `apiKey` in `header`, `query`, or `cookie` — declared name must be present and non-empty.

`oauth2`, `openIdConnect`, and `mutualTLS` schemes are accepted in the
spec but not shape-checked at the validator layer. Failures surface as
a single leaf error with `code: "security"` and `path: ["security"]`,
mapping to HTTP 401 in the default status recipe.

Disable with `createValidator(spec, { validateSecurity: false })` if
you want schema checks only.

`express-openapi-validator`'s `securityHandlers` is a _credential-
verifying_ dispatch table — you supply an auth function per scheme and
eov calls it. `oav` has no equivalent; that role stays with your auth
middleware. If you want the declarative shape, write a small function
that walks the matched operation's `security` array (via
`validator.getOperation`) and dispatches per scheme.

### Type coercion on body fields

Neither validator coerces `{"age": "42"}` to `{"age": 42}` on request
bodies by default; `express-openapi-validator` has a
`validateRequests.coerceTypes` option for this, `oav` has no
equivalent.

Query parameters are different: `oav` auto-coerces scalar query
params per their declared type (`type: integer` → `Number(raw)`,
`type: boolean` → `true`/`false`). Only bodies are strict.

If you need loose body coercion, coerce in your handler after
parsing but before calling downstream logic, or in an
`express.json({ reviver })` callback wired per route. Both keep the
coercion decision out of the validator and in the code that
understands your wire format.

### Ignoring paths not in the spec

Two `createValidator` options cover the common cases directly:

```ts
// Skip every path the spec doesn't declare: equivalent to
// express-openapi-validator's `ignoreUndocumented: true`.
createValidator(spec, { ignoreUndocumented: true });

// Predicate form for prefix / regex / allowlist filtering. Runs
// before routing; returning `true` short-circuits to null.
createValidator(spec, {
  ignorePaths: (p) => p.startsWith("/internal/") || /^\/_debug\//.test(p),
});
```

`ignorePaths` runs before the router; `ignoreUndocumented` only
applies to paths the router couldn't match. Both leave `method`
errors (405 — path exists, verb doesn't) alone.

If you need branching based on the error rather than the path, fall
back to the manual pattern:

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

## Migration from express-openapi-validator

### Option map

#### Spec loading

| `express-openapi-validator` option      | `oav` equivalent                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apiSpec` (path/URL/object)             | `loadSpec({ reader, entry })` + `createValidator(doc)`                                                          |
| `$refParser: "bundle" \| "dereference"` | `loadSpec` inlines external refs; circulars become internal refs. Use `resolveSpec` directly for finer control. |
| `validateApiSpec`                       | Run `oav resolve spec.yaml` in CI; no runtime toggle.                                                           |

#### Request validation

| `express-openapi-validator` option  | `oav` equivalent                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `validateRequests: true`            | `validator.validateRequest(...)` in your middleware.                                                      |
| `validateRequests.allErrors`        | Default — `oav` always collects every leaf. Bound cost with `maxErrors: N`.                               |
| `validateRequests.coerceTypes`      | Query scalars coerced by default; body coercion not supported (see recipe).                               |
| `validateRequests.removeAdditional` | Not supported. `additionalProperties: false` rejects; there is no silent-drop mode.                       |
| `validateRequests.discriminator`    | Native, always on for OpenAPI specs.                                                                      |
| `serDes`                            | Not supported. Pre- or post-transform the payload in your handler if you need `Date` / `ObjectId` / etc.  |
| `ignorePaths` (regex/fn)            | `createValidator(spec, { ignorePaths: (p) => ... })` — predicate that short-circuits before routing.      |
| `ignoreUndocumented`                | `createValidator(spec, { ignoreUndocumented: true })` — returns `null` on paths the router doesn't match. |

#### Response validation

| `express-openapi-validator` option | `oav` equivalent                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `validateResponses: true`          | `validator.validateResponse(...)` in handler or a `res.json` wrapper (see recipes). |

#### Formats and custom keywords

| `express-openapi-validator` option  | `oav` equivalent                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `formats`                           | `createValidator(spec, { formats: { ... } })` — see [format-shape note](#format-shape-note) below.         |
| `validateFormats: "fast" \| "full"` | N/A — single-pass validation; the built-in formats are RFC-sourced.                                        |
| `ajvFormats`                        | Pass custom format functions via the `formats` option — see [format-shape note](#format-shape-note) below. |

#### Security and file uploads

| `express-openapi-validator` option | `oav` equivalent                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `validateSecurity: true`           | Default — shape-only checks for `bearer` / `basic` / `apiKey`. Opt out with `createValidator(spec, { validateSecurity: false })`. |
| `validateSecurity.handlers`        | Your own auth middleware, run before the validator — `oav` only checks credential **shape**, not validity.                        |
| `fileUploader: true`               | Your own multer middleware (see [recipe](#file-uploads-with-multer)).                                                             |

#### Handler wiring

| `express-openapi-validator` option | `oav` equivalent                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `operationHandlers`                | Your own Express routes. `oav` doesn't auto-load handlers from the filesystem. |

### Features not carried over

- **Auto-multer.** Replace with ~15 lines per upload route.
- **Security handler dispatch.** Use your existing auth middleware.
- **`operationHandlers` filesystem routing.** Write Express routes
  manually or keep whatever routing you had.
- **`res.json` wrapping for automatic response validation.** Call
  `validateResponse` explicitly where you need it, or wrap `res.json`
  yourself (~15 lines; see recipe).
- **`serDes` payload mutations.** Do these in your handler rather
  than the validator.
- **Typed error classes** (`BadRequest`, `Unauthorized`, etc.). Use
  the error's `code` field and the status-code map above.

### Features added

- **Structured error tree.** Stable `code`s, segment paths, and
  per-code `params` typed via `BuiltInErrorParams`. Narrowing happens
  on fields rather than message strings.
- **Built-in 3.0 dialect.** No translation layer over 2020-12. See
  [conformance/REPORT.md](./conformance/REPORT.md) for pass / fail
  counts by category.
- **Overlays.** Extend externally-owned specs at load time —
  see [OVERLAYS.md](./OVERLAYS.md).
- **Smaller install footprint.** Single runtime dep (`yaml`) plus
  two optional peers (`commander` for the CLI; `esbuild` only for
  `oav compile --standalone`).
- **No mutation of `req`.** `express-openapi-validator` attaches
  `req.openapi`, coerces types, and replaces `req.body` after
  deserialize. `oav` reads its inputs and returns an error tree;
  the request object is unchanged.
- **Explicit control over where validation runs.** Skip it on
  specific routes without configuration, run it twice (per-request
  and per-response) with different `maxErrors` budgets, or run it at
  the edge of a queue processor outside any HTTP framework.

### Format-shape note

`ajv-formats` and custom formats registered with
`express-openapi-validator` follow the ajv shape:

```ts
formats: {
  duration: { type: "string", validate: (v) => isISODuration(v) },
}
```

`oav` expects a plain string predicate:

```ts
formats: {
  duration: (v) => isISODuration(v),
}
```

When migrating a map of ajv-shaped definitions without rewriting each
one, `@aahoughton/oav/formats` exports `fromAjvFormats` for the
conversion:

```ts
import { fromAjvFormats } from "@aahoughton/oav/formats";

createValidator(spec, { formats: fromAjvFormats(myAjvFormats) });
```

`oav`'s `format` keyword only applies to string values (per JSON
Schema 2020-12 §6.3), so ajv's `type: "number"` format entries are
effectively no-ops — the function never runs on non-string data.
Keep them in the map if it's simpler; they cost nothing.

### Behavior differences to watch for

- **404 vs 405.** Both libraries distinguish them. `oav` emits
  `code: "route"` for no path match and `code: "method"` for a path
  that matched without the requested verb; the `method` error's
  `params.allowed` is the uppercased method list, suitable for a
  405's `Allow` response header.
- **Response body interception.** `express-openapi-validator` catches
  `res.send("{...}")` (string form) too via its wrappers. `oav` does
  not unless you write the wrapper yourself, in which case parse
  before validating.
- **Error paths.** A body-validation failure on a response is at
  `["body", ...]`, not `["response", "body", ...]`. Discriminate the
  leg via the top-level `err.code` (`"request"` vs `"response"`),
  not `path[0]`.
- **Optional `openapi` version fallback.** If the spec's `openapi`
  field is missing or unsupported, `oav` silently uses 3.1 by default
  (see `onUnknownVersion`). `express-openapi-validator` throws.
- **Formats.** Both libraries treat `format` as assertive in an
  OpenAPI context. Under the raw `jsonSchemaDialect`, `oav` treats it
  as annotation-only per the 2020-12 default; the assertion
  vocabulary switches it back on if needed.
