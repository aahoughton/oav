# oav-express4

Express 4 adapter for [`oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core): a request-validator middleware factory plus standalone helpers (`httpRequestFromExpress`, `renderProblemDetails`) for callers composing their own middleware.

Thin: this package re-exports nothing from oav-core. You install both. The adapter declares oav-core as a regular dependency, so a single `npm install @aahoughton/oav-express4` pulls oav-core along; or install [`oav`](https://www.npmjs.com/package/@aahoughton/oav) instead if you want YAML readers and the CLI.

Sibling packages: [`oav-express5`](../oav-express5/README.md), [`oav-fastify`](../oav-fastify/README.md). Same export names, option shapes, and defaults; only the framework-typed argument differs.

> **Migrating from `express-openapi-validator`?** See [docs/migration-from-eov.md](../../docs/migration-from-eov.md) for behavior differences (path-label `/params/` → `/path/`, `errorCode` namespacing, status mapping) and a worked porting walkthrough.

## Install

```bash
# JSON specs only
npm install @aahoughton/oav-core @aahoughton/oav-express4 express

# YAML specs + CLI (oav transitively provides oav-core)
npm install @aahoughton/oav @aahoughton/oav-express4 express
```

`express` is a peer dep; your app's existing install satisfies it.

> **YAML specs.** `oav-core` is JSON-only by design (zero runtime deps). If your spec is YAML, either install [`oav`](https://www.npmjs.com/package/@aahoughton/oav) instead (it bundles the YAML readers and the CLI), or install `yaml` separately and parse the spec yourself before passing the parsed object to `createValidator`.

## Quick start

```ts
import express from "express";
import { createValidator } from "@aahoughton/oav-core";
import { validateRequests } from "@aahoughton/oav-express4";

const validator = createValidator(spec); // see "Hardening for untrusted input" below

const app = express();
app.use(express.json()); // ← MUST run before validateRequests
app.use(validateRequests(validator));

app.post("/pets", (req, res) => res.json({ ok: true }));
```

Invalid requests receive a `400 application/problem+json` response (status from `httpStatusFor`, body from `toProblemDetails`, `Allow` header on 405). Valid requests reach the route handlers.

> **Body parser ordering matters.** `express.json()` (or your equivalent) must run **before** `validateRequests(...)`, otherwise `req.body` is `undefined` and the validator emits `body required` for every request: a misleading error that points at the schema, not at the missing parser. Same for `cookie-parser` if your spec validates cookies. Any middleware that populates `req.body` with a parsed object satisfies oav: `express.json()`, custom streaming parsers, `body-parser`, fastify's bridge, app-specific middleware all work the same way.
>
> **Empty-body normalization.** Some parsers (streaming variants, custom multi-format setups) leave `req.body === undefined` even after they run, for empty `{}`-equivalent payloads. When that happens, `required`-field checks short-circuit on the missing body, so empty submissions pass validation. Normalize via `toHttpRequest`:
>
> ```ts
> import { httpRequestFromExpress, validateRequests } from "@aahoughton/oav-express4";
>
> app.use(
>   validateRequests(validator, {
>     toHttpRequest: (req) => ({ ...httpRequestFromExpress(req), body: req.body ?? {} }),
>   }),
> );
> ```
>
> Stock `express.json()` populates an empty body to `{}` and doesn't hit this, but migrators inheriting alternative parsers (e.g. `body-parser` streaming mode) often do.

## Hardening for untrusted input

The quick start is the minimal wiring. Before exposing the validator to untrusted callers, cap two things so a small, cheap payload can't burn CPU or exhaust the stack. Both are `createValidator` options, and both default to uncapped, so the quick start above sets neither.

```ts
const validator = createValidator(spec, {
  maxDepth: 64, // recursion cap: a body nesting past 64 levels fails as 400
  maxErrors: 10, // stop after 10 errors instead of walking a huge invalid body
});
```

- **`maxDepth`** bounds recursion through self-referential (`$ref`) schemas. Without it, a few KB of deeply nested JSON can exhaust the call stack and surface as a 500. Past the cap, validation emits a `depth` error (mapped to 400) instead of descending. Legitimate payloads rarely recurse beyond ten or fifteen levels, so 32 to 64 is generous.
- **`maxErrors`** caps how many errors one request can produce, in compute and in response size: a large array whose every element fails the same way otherwise yields one error per element. Results carry `truncated: true` when the cap was hit. Leave it unset in development if you want every error at once.

A byte-size limit (`express.json({ limit })`) and a parse-boundary depth cap, applied before the request reaches the validator, are backstops for nesting the validator never traverses (fields the schema doesn't descend into); see [Guarding against deeply nested payloads](https://github.com/aahoughton/oav/blob/main/docs/configuration.md#guarding-against-deeply-nested-payloads).

## API

### `validateRequests(validator, options?)`

Returns an Express 4 `RequestHandler`.

| option          | type                                                        | default                  |
| --------------- | ----------------------------------------------------------- | ------------------------ |
| `toHttpRequest` | `(req: Request) => HttpRequest`                             | `httpRequestFromExpress` |
| `onError`       | `(errors: ValidationError[], ctx) => void \| Promise<void>` | `renderProblemDetails`   |

`onError` may be async; the middleware awaits it. If it throws or rejects, the error is forwarded via `next(err)` so the host's error middleware sees it. The middleware does **not** call `next()` after `onError` returns; your callback owns the response (write to `ctx.res`, or call `ctx.next(err)` to delegate).

> **Validation failures don't traverse Express's error chain by default.** The default `onError` (`renderProblemDetails`) writes the response directly. If you're migrating from `express-openapi-validator` (which emits validation failures as `HttpError` through `next(err)`), your existing error middleware won't see oav's failures unless you forward them; see [Forward to Express's error middleware](#forward-to-expresss-error-middleware) below. Same goes for observability: see [Add observability without changing the response](#add-observability-without-changing-the-response).

### `httpRequestFromExpress(req)`

Convert an Express 4 `Request` to oav's framework-agnostic `HttpRequest` shape. Read what's already on `req`; body parsing is the host app's responsibility.

Header keys lowercased, path stripped of query string, cookies read from `req.cookies` if present.

**Returns a fresh `HttpRequest`.** Top-level fields can be reassigned freely without affecting the original Express `req`; safe to spread (`{ ...httpRequestFromExpress(req), body: {} }`) or mutate in place. The values it references (`req.body`, `req.headers`) are still the originals; deep mutation would still leak, but reassignment doesn't.

Use this when you want to compose your own middleware (e.g. validate inside an existing custom wrapper) without re-implementing the extraction.

### `renderProblemDetails(errors, ctx)`

The default `onError`. Takes the flat list of failing leaves and writes
an RFC 9457 `application/problem+json` body (via `toProblemDetails`),
status from `httpStatusFor`, `Allow` header from `allowHeaderFor` on 405.
`onError` receives the same leaf list whatever `output` the validator
uses (a tree validator's result is flattened first).

Exported standalone so a custom `onError` can call it as the fallback path:

```ts
validateRequests(validator, {
  onError: (errors, ctx) => {
    if (errors.some((e) => e.code === "security")) return ctx.res.status(401).end();
    renderProblemDetails(errors, ctx);
  },
});
```

## Common patterns

### Enable shape-only security checks (no auth middleware yet)

`ValidatorOptions.validateSecurity` is off by default; real apps run auth middleware upstream of the validator, so by the time `validateRequests` runs the credential has already been verified. During early dev (no auth wired yet) or with decorator-only auth that just attaches `req.user`, opt in:

```ts
const validator = createValidator(spec, { validateSecurity: "shape" });
app.use(validateRequests(validator));
```

The check is shape-only: it confirms the declared credential is _present_, not that it's _valid_. Don't treat it as a substitute for auth middleware.

### Per-scheme auth dispatch (the eov `securityHandlers` shape)

eov's `securityHandlers` is a per-scheme dispatch table: you supply an auth function per declared scheme and eov calls it. `oav-express4` doesn't ship this as a helper, but the recipe is small. Mount it as middleware _before_ `validateRequests`:

```ts
import type { Request } from "express";
import { createValidator } from "@aahoughton/oav-core";

type SchemeHandler = (req: Request, scopes: string[]) => Promise<boolean>;

const handlers: Record<string, SchemeHandler> = {
  bearerAuth: async (req, scopes) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    return verifyJwt(token, scopes);
  },
  apiKeyAuth: async (req) => {
    const key = req.header("x-api-key");
    return Boolean(key) && (await verifyApiKey(key));
  },
};

app.use(async (req, res, next) => {
  const op = validator.getOperation({ method: req.method, path: req.path });
  const requirements = op?.operation.security ?? spec.security ?? [];
  if (requirements.length === 0) return next();
  for (const requirement of requirements) {
    let allPass = true;
    for (const [scheme, scopes] of Object.entries(requirement)) {
      const handler = handlers[scheme];
      if (!handler || !(await handler(req, scopes))) {
        allPass = false;
        break;
      }
    }
    if (allPass) return next();
  }
  res.status(401).type("application/problem+json").json({
    type: "about:blank",
    title: "Unauthorized",
    status: 401,
    detail: "no security requirement satisfied",
  });
});

app.use(validateRequests(validator)); // shape check off by default; redundant given the dispatcher above
```

OpenAPI semantics: each requirement object is AND across its scheme keys; the outer array is OR across requirements. The recipe walks them accordingly.

If multiple projects end up copying this recipe, that's the signal to harvest into a `dispatchSecurity(...)` helper export. Not yet.

### Skip validation for paths the spec doesn't declare

The validator owns this: pass it `ignorePaths` or `ignoreUndocumented` at construction. See `ValidatorOptions` in `oav-core` for the contract.

```ts
const validator = createValidator(spec, {
  ignorePaths: (p) => p.startsWith("/internal/"),
});
app.use(validateRequests(validator));
```

### Custom error envelope

```ts
app.use(
  validateRequests(validator, {
    onError: (errors, ctx) => {
      ctx.res.status(httpStatusFor(errors)).json({
        message: `${errors.length} validation error(s)`,
        errors: collectIssues(errors),
      });
    },
  }),
);
```

### Forward to Express's error middleware

```ts
app.use(
  validateRequests(validator, {
    onError: (errors, ctx) => ctx.next(new ValidationFailure(errors)),
  }),
);

app.use((err, _req, res, _next) => {
  if (err instanceof ValidationFailure) {
    res.status(422).json({ ... });
    return;
  }
  // ... your existing error handler
});
```

### Add observability without changing the response

Validation failures don't reach your registered Express error middleware by default (the middleware terminates the request itself). To log every failure while keeping the default problem-details response, compose `renderProblemDetails` after your log call:

```ts
app.use(
  validateRequests(validator, {
    onError: (errors, ctx) => {
      log.warn("validation failed", { path: ctx.req.path, codes: errors.map((e) => e.code) });
      renderProblemDetails(errors, ctx);
    },
  }),
);
```

Use this whenever your existing error pipeline (Sentry, structured logger, request-id correlation) needs to see validation failures without changing the response shape.

### Async `onError` (remote logging, dynamic config)

```ts
app.use(
  validateRequests(validator, {
    onError: async (errors, ctx) => {
      await sentry.captureException(errors);
      renderProblemDetails(errors, ctx);
    },
  }),
);
```

The middleware awaits the returned promise; rejections route to `next(err)`.

### Per-route mounting

`validateRequests(...)` is route-aware (it derives the operation from method+path). Mount it once at the app level; per-route mounting is redundant and may cause double-validation under nested routers.

### Global validator + per-route multer (file uploads)

When the validator is mounted globally and one or a few routes accept file uploads via multer, mount multer at the route prefix that needs it (upstream of the global validator) and use `toHttpRequest` to synthesize the spec-shaped body from `req.files`:

```ts
import multer from "multer";
import { httpRequestFromExpress, validateRequests } from "@aahoughton/oav-express4";

const upload = multer({ storage: multer.memoryStorage() });
app.use("/uploads", upload.any());

app.use(
  validateRequests(validator, {
    toHttpRequest: (req) => {
      const httpReq = httpRequestFromExpress(req);
      const files = req.files as Express.Multer.File[] | undefined;
      if (files && files.length > 0) {
        httpReq.body = files.length === 1 ? files[0]?.buffer : files.map((f) => f.buffer);
      }
      return httpReq;
    },
  }),
);
```

`toHttpRequest` is the general "reshape what oav sees" seam: synthesizing body from files, normalizing empty bodies, merging headers from an upstream proxy, anything that lives above the extraction layer. The empty-body normalization recipe higher in this README and this multer recipe are two examples of the same pattern.

For per-route inline multer (validator called from inside the route handler) and the full multer recipe with text-field reassembly, see the [integration.md file uploads section](https://github.com/aahoughton/oav/blob/main/docs/integration.md#file-uploads-with-multer).

## See also

- [`oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core): `createValidator`, `ValidatorOptions`, `formatSummary`, `collectIssues`, `httpStatusFor`, `toProblemDetails`.
- [`oav`](https://www.npmjs.com/package/@aahoughton/oav): oav-core plus YAML readers and the `oav` CLI.
- The repo-root [`docs/integration.md`](../../docs/integration.md): broader recipes (security, file uploads, response validation, status mapping, type coercion, ignoring paths).
- The repo-root [`docs/migration-from-eov.md`](../../docs/migration-from-eov.md): porting from `express-openapi-validator`.
