# @aahoughton/oav-express5

Express 5 adapter for [`@aahoughton/oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core) — a promise-native middleware factory plus standalone helpers (`httpRequestFromExpress`, `renderProblemDetails`) for callers composing their own middleware.

Same shape as the [`oav-express4`](../oav-express4/README.md) sibling — only the framework-typed argument and the async semantics differ. Express 5's promise-native middleware means thrown errors and rejected promises propagate to the host's error middleware automatically, with no `try/catch` wrapper.

For Fastify / Hono adapters, see the sibling `oav-fastify` / `oav-hono` packages — same API shape, same names, same defaults.

## Install

```bash
# JSON specs only
npm install @aahoughton/oav-core @aahoughton/oav-express5 express

# YAML specs + CLI (oav transitively provides oav-core)
npm install @aahoughton/oav @aahoughton/oav-express5 express
```

`express` is a peer dep — your app's existing install satisfies it.

> **YAML specs.** `@aahoughton/oav-core` is JSON-only by design (zero runtime deps). If your spec is YAML, either install [`@aahoughton/oav`](https://www.npmjs.com/package/@aahoughton/oav) instead — it bundles the YAML readers and the CLI — or install `yaml` separately and parse the spec yourself before passing the parsed object to `createValidator`.

## Quick start

```ts
import express from "express";
import { createValidator } from "@aahoughton/oav-core";
import { validateRequests } from "@aahoughton/oav-express5";

const validator = createValidator(spec);

const app = express();
app.use(express.json()); // ← MUST run before validateRequests
app.use(validateRequests(validator));

app.post("/pets", (req, res) => res.json({ ok: true }));
```

That's it. Invalid requests get a `400 application/problem+json` response (status from `httpStatusFor`, body from `toProblemDetails`, `Allow` header on 405). Valid requests reach your route handlers.

> **Body parser ordering matters.** `express.json()` (or any equivalent that populates `req.body` with a parsed object) must run **before** `validateRequests(...)`. Same for `cookie-parser` if your spec validates cookies. Any middleware that populates `req.body` works — `express.json()`, `body-parser`, custom streaming parsers, app-specific middleware all work the same way.
>
> **Empty-body normalisation.** Some parsers leave `req.body === undefined` for empty `{}`-equivalent payloads. When that happens, `required`-field checks short-circuit on the missing body. Normalise via `toHttpRequest`:
>
> ```ts
> import { httpRequestFromExpress, validateRequests } from "@aahoughton/oav-express5";
>
> app.use(
>   validateRequests(validator, {
>     toHttpRequest: (req) => ({ ...httpRequestFromExpress(req), body: req.body ?? {} }),
>   }),
> );
> ```

## API

### `validateRequests(validator, options?)`

Returns an Express 5 promise-returning `RequestHandler`.

| option          | type                                  | default                  |
| --------------- | ------------------------------------- | ------------------------ |
| `toHttpRequest` | `(req: Request) => HttpRequest`       | `httpRequestFromExpress` |
| `onError`       | `(err, ctx) => void \| Promise<void>` | `renderProblemDetails`   |

`onError` may be async — the middleware awaits it. Express 5 awaits the returned promise, so thrown extractor errors and rejected `onError` promises propagate to the host's error middleware automatically, no `try/catch` needed. The middleware does **not** call `next()` after `onError` returns — your callback owns the response (write to `ctx.res`, or call `ctx.next(err)` to delegate).

> **Validation failures don't traverse Express's error chain by default.** The default `onError` (`renderProblemDetails`) writes the response directly. If you're migrating from `express-openapi-validator` (which emits validation failures as `HttpError` through `next(err)`), your existing error middleware won't see oav's failures unless you forward them — see [Forward to Express's error middleware](#forward-to-expresss-error-middleware) below. Same goes for observability: see [Add observability without changing the response](#add-observability-without-changing-the-response).

### `httpRequestFromExpress(req)`

Convert an Express 5 `Request` to oav's framework-agnostic `HttpRequest` shape. Read what's already on `req` — body parsing is the host app's responsibility.

Header keys lowercased, path stripped of query string, cookies read from `req.cookies` if present.

**Returns a fresh `HttpRequest`.** Top-level fields can be reassigned freely without affecting the original Express `req` — safe to spread (`{ ...httpRequestFromExpress(req), body: {} }`) or mutate in place. The values it references (`req.body`, `req.headers`) are still the originals; deep mutation would still leak, but reassignment doesn't.

Use this when you want to compose your own middleware (e.g. validate inside an existing custom wrapper) without re-implementing the extraction.

### `renderProblemDetails(err, ctx)`

The default `onError`. RFC 9457 `application/problem+json` body (via `toProblemDetails`), status from `httpStatusFor`, `Allow` header from `allowHeaderFor` on 405.

Exported standalone so a custom `onError` can call it as the fallback path:

```ts
validateRequests(validator, {
  onError: (err, ctx) => {
    if (err.code === "security") return ctx.res.status(401).end();
    renderProblemDetails(err, ctx);
  },
});
```

## Common patterns

### Enable shape-only security checks (no auth middleware yet)

`ValidatorOptions.validateSecurity` is off by default — real apps run auth middleware upstream of the validator, so by the time `validateRequests` runs the credential has already been verified. During early dev (no auth wired yet) or with decorator-only auth that just attaches `req.user`, opt in:

```ts
const validator = createValidator(spec, { validateSecurity: true });
app.use(validateRequests(validator));
```

The check is shape-only — it confirms the declared credential is _present_, not that it's _valid_. Don't treat it as a substitute for auth middleware.

### Skip validation for paths the spec doesn't declare

The validator owns this — pass it `ignorePaths` or `ignoreUndocumented` at construction. See `ValidatorOptions` in `@aahoughton/oav-core` for the contract.

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
    onError: (err, ctx) => {
      ctx.res.status(httpStatusFor(err)).json({
        message: summarize(err),
        errors: collectIssues(err),
      });
    },
  }),
);
```

### Forward to Express's error middleware

```ts
app.use(
  validateRequests(validator, {
    onError: (err, ctx) => ctx.next(new ValidationFailure(err)),
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
    onError: (err, ctx) => {
      log.warn("validation failed", { path: ctx.req.path, code: err.code });
      renderProblemDetails(err, ctx);
    },
  }),
);
```

Three lines, no behaviour change for clients. Use this whenever your existing error pipeline (Sentry, structured logger, request-id correlation) needs to see validation failures.

### Async `onError` (remote logging, dynamic config)

```ts
app.use(
  validateRequests(validator, {
    onError: async (err, ctx) => {
      await sentry.captureException(err);
      renderProblemDetails(err, ctx);
    },
  }),
);
```

The middleware awaits the returned promise. Express 5 awaits the middleware itself, so rejections route through Express's native promise handling to the host's error middleware.

### Per-route mounting

`validateRequests(...)` is route-aware (it derives the operation from method+path). Mount it once at the app level — per-route mounting is redundant and may cause double-validation under nested routers.

### Global validator + per-route multer (file uploads)

When the validator is mounted globally and one or a few routes accept file uploads via multer, mount multer at the route prefix that needs it (upstream of the global validator) and use `toHttpRequest` to synthesize the spec-shaped body from `req.files`. See the [INTEGRATION.md file uploads recipe](https://github.com/aahoughton/oav/blob/main/INTEGRATION.md#file-uploads-with-multer) for the full pattern; the only difference for Express 5 is the lack of `try/catch` (which neither the recipe nor the adapter needs).

## Express 4 vs Express 5

Same package shape, same exports, same defaults. The only differences:

- The middleware returned by `validateRequests` is `async` (Express 5 awaits returned promises).
- No `try/catch` wrapper around the extractor — Express 5 routes thrown errors and rejected promises to the error chain via the promise itself.
- `peerDependencies` requires `express ^5.0.0` (oav-express4 requires `^4.0.0`).

A migrating consumer's `import { validateRequests } from "@aahoughton/oav-express5"` is the only line that changes after upgrading from oav-express4.

## See also

- [`@aahoughton/oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core) — `createValidator`, `ValidatorOptions`, `summarize`, `collectIssues`, `httpStatusFor`, `toProblemDetails`.
- [`@aahoughton/oav`](https://www.npmjs.com/package/@aahoughton/oav) — batteries-included distribution of oav-core: YAML readers + the `oav` CLI.
- The repo-root `INTEGRATION.md` — broader recipes (security, file uploads, response validation, status mapping, type coercion, ignoring paths).
- The repo-root `MIGRATION-FROM-EOV.md` — porting from `express-openapi-validator`.
