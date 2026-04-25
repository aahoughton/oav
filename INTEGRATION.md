# Integration guide

A recipe book for wiring `oav` into HTTP frameworks. `oav` is a
validator, not a middleware package — you write a short adapter
between your framework and `validateRequest` / `validateResponse`,
or use one of the companion adapter packages (`oav-express4`, future
`oav-express5` / `oav-fastify` / `oav-hono`) that ships the wiring
for you.

This document is organised:

- **[What the validator expects](#what-the-validator-expects)** —
  the framework-agnostic shapes `validateRequest` and
  `validateResponse` work with.
- **[Supporting helpers](#supporting-helpers)** —
  `httpStatusFor`, `allowHeaderFor`, `toProblemDetails`,
  `summarize`, `collectIssues`. The recipes below assume these.
- **[Per-framework integration](#per-framework-integration)** —
  Express 4, Express 5, Fastify, Next.js, Hono, Bun, Deno. Each
  section leads with the adapter (where one exists) and falls back
  to the manual inline recipe.
- **[Cross-cutting recipes](#cross-cutting-recipes)** —
  status-code mapping, file uploads, response validation, security,
  type coercion, ignoring paths. Linked from the per-framework
  sections.
- **[Migration paths](#migration-paths)** — pointers to focused
  migration docs (currently only
  [MIGRATION-FROM-EOV.md](./MIGRATION-FROM-EOV.md) for
  `express-openapi-validator`).

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

## Supporting helpers

All shipped from `@aahoughton/oav` (or `@aahoughton/oav-core` for the
lean install). The recipes below assume these are in scope.

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
  ones). The `detail` field defaults to `summarize(err)` (a one-line
  description of the first failing leaf); pass `detail` explicitly
  for an override.

- **`summarize(err, opts?)`** — single-line summary of the first
  failing leaf as `<dotted-path> <message>`. Use it directly for log
  lines, error-monitoring titles (Sentry/New Relic group by message),
  or as the top-level `message` field in custom response envelopes.
  See `SummarizeOptions.select` for the leaf-picking policy
  (`"first"` / `"deepest"` / `{ byCode }`).

- **`collectIssues(err)`** — flat leaf list. Each issue carries both
  a raw `path: PathSegment[]` and a pre-formatted RFC 6901 `pointer`
  string. Use this when you're keeping a custom envelope shape
  rather than RFC 9457 problem-details.

```ts
import {
  allowHeaderFor,
  collectIssues,
  httpStatusFor,
  summarize,
  toProblemDetails,
} from "@aahoughton/oav";
```

## Per-framework integration

### Express 4

The [`@aahoughton/oav-express4`](https://www.npmjs.com/package/@aahoughton/oav-express4)
companion package ships the middleware as a one-liner:

```ts
import { validateRequests } from "@aahoughton/oav-express4";

app.use(express.json()); // any middleware that populates req.body satisfies oav
app.use(validateRequests(validator));
```

Sensible defaults: RFC 9457 `application/problem+json` body via
`toProblemDetails`, status from `httpStatusFor`, `Allow` header from
`allowHeaderFor` on 405. The package also exports
`httpRequestFromExpress(req)` (the extractor) and
`renderProblemDetails(err, ctx)` (the default renderer) standalone,
for callers composing their own middleware. See the
[adapter README](https://github.com/aahoughton/oav/blob/main/packages/oav-express4/README.md)
for options (`toHttpRequest`, `onError`), async `onError` semantics,
custom envelope recipes, and the patterns in the cross-cutting
section below.

**Manual middleware (when you need full control).** Same shape as
the Express 5 snippet below, with one twist: Express 4 doesn't
await returned promises, so async errors don't propagate
automatically. Wrap in `try/catch`:

```ts
app.use((req, res, next) => {
  try {
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
  } catch (e) {
    next(e);
  }
});
```

See [body-parser caveats](#body-parser-caveats) and other
cross-cutting recipes below.

### Express 5

The [`@aahoughton/oav-express5`](https://www.npmjs.com/package/@aahoughton/oav-express5)
companion package ships the middleware as a one-liner — same shape
as `oav-express4` but promise-native (no `try/catch` wrapper):

```ts
import { validateRequests } from "@aahoughton/oav-express5";

app.use(express.json());
app.use(validateRequests(validator));
```

Same exports as `oav-express4` (`httpRequestFromExpress`,
`renderProblemDetails` standalone), same options (`toHttpRequest`,
`onError`), same defaults. See the
[adapter README](https://github.com/aahoughton/oav/blob/main/packages/oav-express5/README.md)
for options, async `onError` semantics, and common patterns.

**Manual middleware (when you need full control).** Express 5 is
promise-native: async middleware that throws routes to the error
handler automatically.

```ts
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

Requires `express.json()` (or any equivalent middleware that
populates `req.body` with a parsed object) registered before this
middleware, and `cookie-parser` if you use the `cookies` field.
Custom streaming parsers, `body-parser`, fastify's bridge, and
app-specific middleware all work the same way — oav doesn't care
_how_ `req.body` got populated, only that it's there.

See [body-parser caveats](#body-parser-caveats) for sharp edges
that affect this pattern.

### Fastify

The [`@aahoughton/oav-fastify`](https://www.npmjs.com/package/@aahoughton/oav-fastify)
companion package ships the hook as a one-liner — same shape as the
Express adapters but Fastify-native (a `preValidation` hook, not
middleware):

```ts
import { validateRequests } from "@aahoughton/oav-fastify";

app.addHook("preValidation", validateRequests(validator));
```

Same cross-adapter exports (`httpRequestFromFastify`,
`renderProblemDetails` standalone), same options (`toHttpRequest`,
`onError`), same defaults. See the
[adapter README](https://github.com/aahoughton/oav/blob/main/packages/oav-fastify/README.md)
for options, async `onError` semantics, common patterns, and the
relationship to Fastify's own per-route schema validation.

**Manual hook (when you need full control).** Register as a
`preValidation` hook so it runs after Fastify's own body parsing
but before the route handler.

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

Note: Fastify's idiomatic per-route-schema pattern (`route({ schema:
{ body, response } })`) is independent of oav. Use oav-fastify when
the OpenAPI spec is the source of truth; use Fastify's built-in
schema validation when you author schemas inline.

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

## Cross-cutting recipes

### Status-code mapping

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
const allow = allowHeaderFor(err);
if (allow !== undefined) res.setHeader("Allow", allow);
```

For richer response envelopes, `toProblemDetails` produces
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)
`application/problem+json` with the failing leaves as an `issues`
field. `collectIssues` is the raw flat leaf list if you want to roll
your own response shape.

### Body parser caveats

oav doesn't parse bodies — it validates already-parsed bodies. Two
sharp edges that bite both inline middleware and the
`oav-express4` adapter:

1. **Malformed JSON throws before oav runs.** `express.json()` throws
   a `SyntaxError` on bad JSON, and Express's default error handler
   emits an HTML page. Install an Express error middleware to convert
   it to `application/problem+json` upstream of the validator.

2. **Empty-body normalisation.** Some body parsers (streaming
   variants, custom multi-format setups) leave `req.body === undefined`
   for empty `{}`-equivalent payloads instead of an empty object. When
   that happens, oav's `required`-field checks short-circuit on the
   missing body — validation passes for what the client thinks is an
   empty submission, even when the spec marks fields as `required`.
   If your parser does this, normalise before calling `validateRequest`:

   ```ts
   body: req.body ?? {},
   ```

   Stock `express.json()` populates `req.body` to `{}` for an empty
   JSON body, so the default Express stack doesn't hit this — but
   alternative parsers (`body-parser`'s streaming mode, fastify's
   bridge, custom multipart middleware) often do.

   For consumers using `oav-express4`, override the extractor:

   ```ts
   import { httpRequestFromExpress, validateRequests } from "@aahoughton/oav-express4";

   app.use(
     validateRequests(validator, {
       toHttpRequest: (req) => ({ ...httpRequestFromExpress(req), body: req.body ?? {} }),
     }),
   );
   ```

(Unmatched `Content-Type` is handled correctly without extra wiring:
even when `express.json()` leaves `req.body` empty for a non-JSON
request, oav sees the declared header, finds no matching media type
in the spec, and returns a `content-type` leaf that maps to 415. The
sibling case — **no Content-Type AND no body** — returns `body` /
400 instead of 415, since there's no client signal about format
intent to be "wrong about." Tests that exercise the 415 path need to
send an explicit unmatched Content-Type.)

### File uploads with multer

Install `multer` and its types yourself, run multer before the
validator, and reconstruct the body for the validator call.

```sh
pnpm add multer
pnpm add -D @types/multer    # else every Express.Multer.File reference goes red
```

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

#### Global validator + per-route multer

The recipe above is per-route inline — multer and the validator both
live inside the route handler. That works for single-upload-route
apps. For an app with many routes and one (or a few) upload
endpoints, a more idiomatic shape is **multer mounted at the route
prefix, validator mounted globally**, with `toHttpRequest`
synthesizing the spec-shaped body from `req.files`:

```ts
import multer from "multer";
import { httpRequestFromExpress, validateRequests } from "@aahoughton/oav-express4";

const upload = multer({ storage: multer.memoryStorage() });

// Mount multer at the route prefix that needs it, before the global validator.
app.use("/uploads", upload.any());

// Global validator with toHttpRequest synthesizing body from req.files.
app.use(
  validateRequests(validator, {
    toHttpRequest: (req) => {
      const httpReq = httpRequestFromExpress(req);
      const files = req.files as Express.Multer.File[] | undefined;
      if (files && files.length > 0) {
        // Match the spec's binary-field shape — array if many, single buffer if one.
        // Adjust to your spec's actual field shape (named-files object, single-file
        // property, etc.).
        httpReq.body = files.length === 1 ? files[0]?.buffer : files.map((f) => f.buffer);
      }
      return httpReq;
    },
  }),
);
```

The `toHttpRequest` extension point is a general seam for **any
"reshape what oav sees"** use case — synthesizing a body from
`req.files`, normalizing an empty body to `{}`, merging headers
from an upstream proxy, anything that wants to live above the
extraction layer without bypassing it. The empty-body normalization
recipe in [body-parser caveats](#body-parser-caveats) and this
multer-body-synthesis recipe are two examples of the same pattern.

**Watch out for `oneOf` / `anyOf` with binary fields.** The "accept
anything" rewrite means every binary branch matches every input. A
common spec pattern for "one file or many" —
`oneOf [array<binary>, binary]` — is silently ambiguous: both
branches match the same payload, so `oneOf` fails with
`matchCount: 2`. The fix is usually to drop the `oneOf` and accept
the array form (parsers like multer always deliver arrays anyway);
the original spec was already ambiguous before oav surfaced it.

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

oav doesn't wrap `res.json` / `res.send`. Two patterns:

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
    log.warn("response validation failed", { path: req.path, err });
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
      // Default: log + send anyway. See "Failure mode" below.
      res.setHeader("X-Response-Validation", "failed");
      log.warn("response validation failed", { path: req.path, err });
    }
    return json(body);
  };
  next();
});
```

The `res.json` wrapper is ~15 lines.

#### Failure mode: log, don't fail-hard (by default)

The previous snippets log + send-anyway because that's the right
default. The instinct to flip the failure into a 500 — don't, at
least not without warning.

**Why.** The strict-mode failure path runs on _every_ response,
including the ones your error handler emits. If your error handler
sends `{ error: "...", code: "..." }` for 4xx responses but the
spec's `ErrorResponse` schema requires `title` (or sets
`additionalProperties: false`, or expects different field names),
fail-hard mode rewrites legitimate 4xx responses as 500s. That's
worse than the original validation gap: the client now sees a
server error for a request that was their fault, and your error
budget burns for free.

**The recommended progression:**

1. **Ship with log-only.** You'll get coverage of every response
   shape your handlers actually emit, including the error paths.
2. **Read the logs.** Triage the failures: real bugs in handler
   output go to the issue tracker; spec-vs-error-handler shape
   mismatches go to the spec (or to a tighter error envelope).
3. **Tighten gradually.** Once the log is quiet for a sustained
   period, you can flip the policy in your `res.json` wrapper:

   ```ts
   if (err !== null) {
     log.error("response validation failed (hard)", { path: req.path, err });
     res.statusCode = 500;
     return json(toProblemDetails(err, { instance: req.originalUrl }));
   }
   ```

   Even then, consider gating the hard-fail on `process.env.NODE_ENV
!== "production"` so dev sees the failure loudly while prod
   stays log-only — error responses in prod are exactly when you
   least want a 500-on-top-of-a-400.

### Security / authentication

`oav` performs **shape-only** security validation (when opted in
via `validateSecurity: true`): it confirms the request carries the
credential location declared by the spec (a `Bearer` token in
`Authorization`, the declared apiKey header / query / cookie, a
base64 `Basic user:pass` pair), but it does **not** verify the
credential itself. That's your auth middleware's job; keep it
upstream of the validator.

```ts
app.use(authenticateJwt); // verifies tokens, populates req.user
app.use(oavMiddleware); // shape + schema checks
```

The shape check (when enabled) runs against each operation's
`security:` (or document-level `security:` when the operation doesn't
override). Supported:

- `http` with `scheme: "bearer"` — requires `Authorization: Bearer <non-empty>`.
- `http` with `scheme: "basic"` — requires `Authorization: Basic <base64>`; the base64 must decode to a `user:pass` shape (no credential verification).
- `apiKey` in `header`, `query`, or `cookie` — declared name must be present and non-empty.

`oauth2`, `openIdConnect`, and `mutualTLS` schemes are accepted in the
spec but not shape-checked at the validator layer. Failures surface as
a single leaf error with `code: "security"` and `path: ["security"]`,
mapping to HTTP 401 in the default status recipe.

**Off by default.** Real apps run auth middleware upstream of the
validator, so by the time `validateRequest` runs the credential has
already been verified. Enable with `createValidator(spec, {
validateSecurity: true })` when there's no auth middleware (early
dev / prototyping) or when the auth layer only decorates `req`
without rejecting unauthenticated traffic. The check is shape-only
and is **not** a substitute for actual credential verification.
See `ValidatorOptions.validateSecurity` for the option contract;
this section is the recipe.

#### Per-scheme auth dispatch

When you want the declarative shape (per-scheme handlers keyed off
the spec's `security:` declaration), write a small dispatcher that
walks the matched operation via `validator.getOperation` and fans
out per scheme:

```ts
type SchemeHandler = (
  req: HttpRequest,
  scopes: string[],
) => Promise<{ ok: true; user: unknown } | { ok: false; reason: string }>;

const handlers: Record<string, SchemeHandler> = {
  bearerAuth: async (req, scopes) => {
    const token = req.headers?.authorization?.toString().replace(/^Bearer /, "");
    return verifyJwt(token, scopes); // your existing auth
  },
  apiKeyAuth: async (req) => verifyApiKey(req.headers?.["x-api-key"]),
  // oauth2, basic, whatever else your spec declares
};

async function dispatchSecurity(
  req: HttpRequest,
): Promise<{ ok: true; user?: unknown } | { ok: false; reason: string }> {
  const op = validator.getOperation({ method: req.method, path: req.path });
  // Fall back to document-level security when the operation omits it.
  const requirements = op?.operation.security ?? spec.security ?? [];
  if (requirements.length === 0) return { ok: true };
  // OpenAPI: each requirement object is AND across its scheme keys; the
  // outer array is OR across requirements. First requirement that fully
  // passes wins.
  for (const requirement of requirements) {
    let allPass = true;
    let lastUser: unknown;
    for (const [scheme, scopes] of Object.entries(requirement)) {
      const handler = handlers[scheme];
      if (!handler) {
        allPass = false;
        break;
      }
      const r = await handler(req, scopes);
      if (!r.ok) {
        allPass = false;
        break;
      }
      lastUser = r.user;
    }
    if (allPass) return { ok: true, user: lastUser };
  }
  return { ok: false, reason: "no security requirement satisfied" };
}
```

Mount the dispatcher as middleware _before_ `validateRequests` (or
your inline validator middleware). Reject (`401` / `403` per your
policy) on `{ ok: false }` before validation runs. The validator's
own `validateSecurity` shape check is then redundant — leave it at
its default `false`.

For framework-adapter consumers (`oav-express4`, future siblings),
the same dispatcher pattern works; only the request-shape extraction
changes (`httpRequestFromExpress(req)`, etc.).

### Type coercion on body fields

oav doesn't coerce `{"age": "42"}` to `{"age": 42}` on request
bodies by default.

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
createValidator(spec, { ignoreUndocumented: true });

createValidator(spec, {
  ignorePaths: (p) => p.startsWith("/internal/") || /^\/_debug\//.test(p),
});
```

`ignorePaths` runs before the router; `ignoreUndocumented` only
applies to paths the router couldn't match. Both leave `method`
errors (405 — path exists, verb doesn't) alone. See
`ValidatorOptions.ignorePaths` / `ValidatorOptions.ignoreUndocumented`
for the option contracts.

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

## Migration paths

Focused migration docs live in their own files so this guide can
stay framework-shaped rather than competitor-shaped:

- **[MIGRATION-FROM-EOV.md](./MIGRATION-FROM-EOV.md)** — migrating
  from `express-openapi-validator`. Behavior-difference reference,
  option map (eov → oav), features not carried over, features
  added.

Future migration docs (from-fastify-inline, from-zod-first, etc.)
will follow the same pattern — focused, one-page references, linked
from here.
