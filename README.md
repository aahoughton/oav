# oav

Codegen-based HTTP validator for OpenAPI **3.0**, **3.1**, and **3.2**.
Compiles every operation's schemas to JavaScript at construction time,
then checks live requests and responses against the resulting functions
and returns a **tree of structural errors** you can format, filter, or
walk programmatically.

- One validator call checks method + path + parameters + body + content
  type + status + headers against the spec — not just the JSON body.
- Structured error trees (not flat arrays), so downstream code can
  distinguish a missing `required` property from a `oneOf` branch
  failure from an unsupported `Content-Type`.
- Real 3.0 support (`nullable`, boolean `exclusiveMaximum`,
  `$ref`-suppresses-siblings), not "3.1 and hope".
- Codegen-compiled at construction, cached by schema identity, zero
  per-request version branching. Handles recursive `$ref`, multi-file
  specs, overlays, and custom keywords / formats.

## Install

```bash
npm install @aahoughton/oav
# or: pnpm add @aahoughton/oav
```

The library has a single runtime dependency (`yaml`). The `oav` CLI
additionally needs `commander`, declared as an optional peer — if you
plan to use the CLI, add it explicitly:

```bash
npm install @aahoughton/oav commander
```

## Quick start

```ts
import { createValidator, formatText } from "@aahoughton/oav";
import { composeReaders, createFileReader, loadSpec } from "@aahoughton/oav/spec";

const reader = composeReaders([createFileReader()]);
const { document } = await loadSpec({ reader, entry: "openapi.yaml" });
const validator = createValidator(document);

const err = validator.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  headers: { "x-tenant": "acme" },
  body: { name: "Fido" },
});

if (err !== null) console.error(formatText(err));
```

`validateRequest` / `validateResponse` return `null` on success or a
`ValidationError` tree on failure. Every error carries a stable `code`
(e.g. `"type"`, `"required"`, `"content-type"`, `"oneOf"`), a `path`
rooted at the HTTP frame (e.g. `["body", "pets", 3, "name"]`), a
human-readable `message`, and a machine-readable `params` object whose
shape per code is documented in `BuiltInErrorParams`.

## CLI

```bash
oav resolve openapi.yaml
oav validate openapi.yaml --request req.http
oav validate openapi.yaml --path "POST /pets" --body payload.json
oav validate openapi.yaml --path "GET /pets" --response --status 200 --body resp.json
```

Flags: `--format text|json|flat|github`, `--depth n`, `--overlay file`
(repeatable), `-o file`, `--quiet`. See
[packages/cli/README.md](./packages/cli/README.md) for the full surface
and the `.http` file format.

## Versions

`createValidator` reads the spec's `openapi` string once at construction
and picks the matching dialect. No per-request branching.

| Spec  | Dialect               | Notes                                                       |
| ----- | --------------------- | ----------------------------------------------------------- |
| 3.0.x | OAS 3.0 Schema Object | `nullable`, boolean `exclusiveMin/Max`, sibling-`$ref` drop |
| 3.1.x | JSON Schema 2020-12   | Assertive `format`                                          |
| 3.2.x | JSON Schema 2020-12   | Same as 3.1 + the `QUERY` HTTP method                       |

Override via `createValidator(spec, { dialect })` to force or customise
one of the built-in dialects (`jsonSchemaDialect`, `openapi31Dialect`,
`oas30Dialect`). Unknown / missing `openapi` strings fall back to the
3.1 dialect by default; configure with
`onUnknownVersion: "throw" | "warn" | "fallback31"`.

## Configuring the validator

| Option                  | Effect                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `dialect`               | Force a specific schema dialect, bypassing version detection.  |
| `formats`               | Extra string format validators merged on top of the built-ins. |
| `keywords`              | Register user-defined schema keywords (see below).             |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail, default is uncapped.     |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.           |
| `onUnknownVersion`      | Policy for specs with missing/unsupported `openapi`.           |

### Custom keywords

```ts
const validator = createValidator(spec, {
  keywords: {
    activeTenant: (data) =>
      typeof data !== "string" || tenantCache.has(data)
        ? true
        : { message: `tenant "${data}" is not active` },
  },
});
```

Custom keywords plug into generated code alongside the built-ins. See
[examples/custom-keywords.ts](./examples/custom-keywords.ts).

### Bounded error collection

```ts
createValidator(spec, { maxErrors: 1 }); // fast-fail
createValidator(spec, { maxErrors: 10 }); // bound CPU/memory on huge payloads
```

Hot loops (array items, object properties, `allOf`/`anyOf` branches)
short-circuit once the budget is exhausted. Results carry
`truncated: true` so callers know the tree was capped.

## Framework integration

`oav` doesn't ship framework-specific middleware — Express, Fastify,
and Next.js each evolve their own idioms, and the adapter per
framework is ~15 lines of straightforward glue. What the library does
ship is `toProblemDetails` (RFC 9457 `application/problem+json`
response envelope) and `collectIssues` (flat leaves with RFC 6901
JSON Pointers). Wire them into your framework of choice with the
snippets below.

### What the validator expects

`validateRequest` / `validateResponse` take a framework-agnostic
`HttpRequest` / `HttpResponse`. The adapter's job is extracting those
fields from the framework's own request object:

```ts
interface HttpRequest {
  method: string; // uppercase verb
  path: string; // pathname only
  query?: Record<string, string | string[]>; // parsed query params
  headers?: Record<string, string | string[]>; // lowercased header names
  contentType?: string; // may include "; charset=utf-8"
  body?: unknown; // already-parsed (object / FormData / string)
  cookies?: Record<string, string>;
}
```

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
    .status(400)
    .type("application/problem+json")
    .json(toProblemDetails(err, { instance: req.originalUrl }));
});
```

Requires `express.json()` (and `cookie-parser` if you use `cookies`)
registered before this middleware.

### Express 4

The `req` surface didn't change between majors, so the extraction is
identical. The difference is that Express 4 doesn't await returned
promises — uncaught async errors don't propagate. Use `try`/`catch` to
forward to the error handler:

```ts
app.use((req, res, next) => {
  try {
    const err = validator.validateRequest(/* same as Express 5 */);
    if (err === null) return next();
    res
      .status(400)
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
import { toProblemDetails } from "@aahoughton/oav";

fastify.addHook("preValidation", async (request, reply) => {
  const err = validator.validateRequest({
    method: request.method,
    path: request.url.split("?")[0] ?? "/",
    query: request.query as Record<string, string | string[]>,
    headers: request.headers as Record<string, string | string[]>,
    contentType: request.headers["content-type"],
    body: request.body,
    // cookies: request.cookies — requires @fastify/cookie
  });
  if (err !== null) {
    return reply
      .code(400)
      .type("application/problem+json")
      .send(toProblemDetails(err, { instance: request.url }));
  }
});
```

Fastify parses JSON bodies automatically; for other formats register
the appropriate content-type parser (`@fastify/formbody`, etc.) ahead
of the hook.

### Next.js (App Router)

Next.js App Router route handlers receive a Web Standards `Request`
and return a `Response` — no middleware chain. Do the validation at
the top of each handler, or factor it into a shared `validate(request)`
helper:

```ts
import { toProblemDetails } from "@aahoughton/oav";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const contentType = request.headers.get("content-type") ?? undefined;
  const body = contentType?.includes("json") ? await request.json() : await request.text();

  const err = validator.validateRequest({
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: Object.fromEntries(request.headers.entries()),
    contentType,
    body,
  });

  if (err !== null) {
    return Response.json(toProblemDetails(err, { instance: request.url }), {
      status: 400,
      headers: { "Content-Type": "application/problem+json" },
    });
  }

  // ... handler logic
}
```

Two Next.js-specific notes:

- `Object.fromEntries(searchParams.entries())` takes the last value
  for repeated keys. If your spec uses `?ids=1&ids=2&ids=3` style
  (form-explode arrays), call `searchParams.getAll(name)` per
  parameter instead.
- The top-level `middleware.ts` runs on the Edge runtime and doesn't
  know which route matched yet. Validate inside the route handler,
  not in `middleware.ts`.

The same shape works for Hono, Bun, and Deno servers — they all speak
Web Standards `Request` / `Response`.

## Modules

The package publishes a small root and four subpath entrypoints:

| Import                    | Surface                                                  |
| ------------------------- | -------------------------------------------------------- |
| `@aahoughton/oav`         | `createValidator`, error helpers, formatters, types      |
| `@aahoughton/oav/schema`  | `compileSchema`, dialects, vocabularies, custom keywords |
| `@aahoughton/oav/spec`    | `loadSpec`, `resolveSpec`, `applyOverlays`, readers      |
| `@aahoughton/oav/formats` | Built-in string format validators                        |
| `@aahoughton/oav/core`    | Error tree model, shared OpenAPI / HTTP types            |

The `oav` CLI is installed as a `bin` by the same package.

## Examples

Runnable, self-contained TypeScript examples in
[`examples/`](./examples/README.md):

| File                  | Shows                                                |
| --------------------- | ---------------------------------------------------- |
| `basic-validation.ts` | Inline spec → validator → request & response checks  |
| `custom-formats.ts`   | Register a string format                             |
| `custom-keywords.ts`  | Register a schema keyword with dynamic runtime state |
| `max-errors.ts`       | Fast-fail and bounded error collection               |
| `versions.ts`         | 3.0 / 3.1 / 3.2 side by side                         |
| `overlay.ts`          | Apply a spec overlay before validating               |

## Known limitations

- `unevaluatedProperties` / `unevaluatedItems` do not propagate
  evaluation sets across `allOf` / `anyOf` / `oneOf`. Covers the common
  case; may produce false positives under composition.
- `$dynamicRef` behaves like `$ref` with anchor lookup — no runtime
  dynamic-scope traversal.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch / PR / release flow.
Development workflow (lint / typecheck / test / build) and the
conformance and performance sub-packages are described there and in
[CLAUDE.md](./CLAUDE.md).

## License

MIT — see [LICENSE](./LICENSE).
