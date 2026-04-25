# @aahoughton/oav-express4

Express 4 adapter for [`@aahoughton/oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core) — a request-validator middleware factory plus standalone helpers (`httpRequestFromExpress`, `renderProblemDetails`) for callers composing their own middleware.

Thin: this package re-exports nothing from oav-core. You install both. The adapter declares oav-core as a regular dependency, so a single `npm install @aahoughton/oav-express4` pulls oav-core along; or install [`@aahoughton/oav`](https://www.npmjs.com/package/@aahoughton/oav) instead if you want YAML readers and the CLI.

For Express 5 / Fastify / Hono adapters, see the sibling `oav-express5` / `oav-fastify` / `oav-hono` packages — same API shape, same names, same defaults.

## Install

```bash
# JSON specs only
npm install @aahoughton/oav-core @aahoughton/oav-express4 express

# YAML specs + CLI (oav transitively provides oav-core)
npm install @aahoughton/oav @aahoughton/oav-express4 express
```

`express` is a peer dep — your app's existing install satisfies it.

## Quick start

```ts
import express from "express";
import { createValidator } from "@aahoughton/oav-core";
import { validateRequests } from "@aahoughton/oav-express4";

const validator = createValidator(spec);

const app = express();
app.use(express.json()); // ← MUST run before validateRequests
app.use(validateRequests(validator));

app.post("/pets", (req, res) => res.json({ ok: true }));
```

That's it. Invalid requests get a `400 application/problem+json` response (status from `httpStatusFor`, body from `toProblemDetails`, `Allow` header on 405). Valid requests reach your route handlers.

> **Body parser ordering matters.** `express.json()` (or your equivalent) must run **before** `validateRequests(...)`, otherwise `req.body` is `undefined` and the validator emits `body required` for every request — a misleading error that points at the schema, not at the missing parser. Same for `cookie-parser` if your spec validates cookies.

## API

### `validateRequests(validator, options?)`

Returns an Express 4 `RequestHandler`.

| option          | type                                  | default                  |
| --------------- | ------------------------------------- | ------------------------ |
| `toHttpRequest` | `(req: Request) => HttpRequest`       | `httpRequestFromExpress` |
| `onError`       | `(err, ctx) => void \| Promise<void>` | `renderProblemDetails`   |

`onError` may be async — the middleware awaits it. If it throws or rejects, the error is forwarded via `next(err)` so the host's error middleware sees it. The middleware does **not** call `next()` after `onError` returns — your callback owns the response (write to `ctx.res`, or call `ctx.next(err)` to delegate).

### `httpRequestFromExpress(req)`

Convert an Express 4 `Request` to oav's framework-agnostic `HttpRequest` shape. Read what's already on `req` — body parsing is the host app's responsibility.

Header keys lowercased, path stripped of query string, cookies read from `req.cookies` if present.

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

The middleware awaits the returned promise; rejections route to `next(err)`.

### Per-route mounting

`validateRequests(...)` is route-aware (it derives the operation from method+path). Mount it once at the app level — per-route mounting is redundant and may cause double-validation under nested routers.

## See also

- [`@aahoughton/oav-core`](https://www.npmjs.com/package/@aahoughton/oav-core) — `createValidator`, `ValidatorOptions`, `summarize`, `collectIssues`, `httpStatusFor`, `toProblemDetails`.
- [`@aahoughton/oav`](https://www.npmjs.com/package/@aahoughton/oav) — batteries-included distribution of oav-core: YAML readers + the `oav` CLI.
- The repo-root `INTEGRATION.md` — broader recipes (security, file uploads, response validation, migration from `express-openapi-validator`).
