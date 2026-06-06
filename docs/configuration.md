# Configuring the validator

`createValidator(spec, options)` accepts the options below. The
canonical reference is the
[`ValidatorOptions`](../packages/validator/src/validator.ts) TSDoc;
this page is a recipe-oriented overview.

| Option                  | Effect                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dialect`               | Force a specific schema dialect, bypassing version detection.                                                                                                                                  |
| `formats`               | Extra string format validators merged on top of the built-ins.                                                                                                                                 |
| `keywords`              | Register user-defined schema keywords (see below).                                                                                                                                             |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail, default is uncapped.                                                                                                                                     |
| `strict`                | Compile-time schema lint mode: `"off"`, `"warn-partial"` (default), or `"strict"`. Issues surface via `validator.stats.strictIssues`.                                                          |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.                                                                                                                                           |
| `validateSecurity`      | `"off"` (default), `"shape"` (check recognized schemes; pass on oauth2/oidc/mTLS), or `"strict"` (fail on unrecognized schemes). Boolean form deprecated; `true`->`"shape"`, `false`->`"off"`. |
| `ignoreUndocumented`    | Return `null` on requests whose path the router can't match. Default `false`.                                                                                                                  |
| `ignorePaths`           | Predicate `(path) => boolean`; returning `true` short-circuits validation to `null` before routing.                                                                                            |
| `onUnknownVersion`      | Policy for specs with missing/unsupported `openapi`: `"fallback31"` (default), `"warn"`, or `"throw"`.                                                                                         |
| `regexCompiler`         | Compiler for `pattern` keywords and `format: "regex"`. Defaults to `new RegExp(p, "u")` with a non-u fallback. Plug in `re2` or a safe-regex check for hardening; see below.                   |

## Custom keywords

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
[`examples/custom-keywords.ts`](../examples/custom-keywords.ts) for an
end-to-end run, and `CustomKeywordValidator` in the TSDoc for the full
return-shape contract (boolean, error object, or array of errors).

## Bounded error collection

```ts
createValidator(spec, { maxErrors: 1 }); // fast-fail
createValidator(spec, { maxErrors: 10 }); // bound CPU/memory on huge payloads
```

Hot loops (array items, object properties, `allOf` / `anyOf` branches)
short-circuit once the budget is exhausted. Results carry
`truncated: true` so callers know the tree was capped.

`maxErrors` must be a positive integer (>= 1); `createValidator`
throws on `0`, negative values, or non-integers. To opt out of error
collection entirely (yes/no answers only), use `compileSchema(schema,
{ predicate: true })` from `@aahoughton/oav/schema` instead.

## Hardening against untrusted regex patterns

`pattern` keywords and `format: "regex"` compile to JavaScript's
built-in `RegExp`, which has no execution timeout. A catastrophic
pattern like `(a+)+$` is a denial-of-service vector against any
string the validator checks. The risk is real only when the spec is
attacker-controlled: multi-tenant SaaS accepting uploads,
spec-editing tools, mock-as-a-service. For first-party specs the
default is fine; vet your sources.

When the spec is untrusted, pass a `regexCompiler` that wraps a safe
engine. `re2` is the standard choice (linear-time matching, no
catastrophic backtracking) on platforms that allow a native dep:

```ts
import RE2 from "re2";
import { createValidator } from "@aahoughton/oav";

const validator = createValidator(spec, {
  regexCompiler: (pattern) => new RE2(pattern),
});
```

Invocation cadence is split: schema-authored `pattern` strings are
memoized for the validator's lifetime (bounded by spec size), so
the compiler runs once per unique pattern there. `format: "regex"`
runs the compiler per `validate()` call against the candidate
string; caching runtime values would retain user input indefinitely,
which is the opposite of what hardening callers want.

The runtime only reads `.test(s)` off the returned object, so
anything that satisfies `{ test(s: string): boolean }` works. A
typical complexity-check wrapper:

```ts
import safeRegex from "safe-regex";

createValidator(spec, {
  regexCompiler: (pattern) => {
    if (!safeRegex(pattern)) {
      throw new Error(`unsafe regex: ${pattern}`);
    }
    return new RegExp(pattern, "u");
  },
});
```

`oav` does not bundle `re2` or any other engine: edge runtimes
(Cloudflare Workers, Vercel Edge) don't support native modules, and
the right answer for those environments is a different tradeoff
(pattern-length cap, allowlist of permitted patterns, etc.) which
your `regexCompiler` can encode.

Throws inside the compiler:

- For `pattern` keywords, a throw surfaces at validator-construction
  time (`compileSchema` calls the compiler eagerly).
- For `format: "regex"`, a throw is caught and translated into a
  `format` validation error against the value.

`pattern` and `format: "regex"` use the same compiler policy: one
`regexCompiler` covers both, and there's no second hook to keep in
sync. `format: "regex"` is auto-registered by `@oav/schema` and no
longer ships from `@oav/formats`'s `builtInFormats`; a user-supplied
entry in `formats` still overrides it if you want a different policy
for the format than for `pattern`.

## Guarding against deeply nested payloads

Recursive schemas (a `$ref` that points back at an ancestor, common
for tree and comment structures) compile to validation functions that
call themselves once per level of nested data. Validation depth tracks
the payload's nesting depth, and the JavaScript call stack has no
built-in limit you can rely on. A small but deeply nested payload (an
array nested a few thousand levels, only a few KB on the wire) can
exhaust the stack and throw `RangeError: Maximum call stack size
exceeded`.

`oav` does not impose a depth limit of its own: the safe ceiling
depends on the runtime's stack size and on how much stack each
validation frame consumes, both of which the caller controls better
than the library can. The framework adapters catch the `RangeError`
and turn it into a 500, so a single request fails rather than the
process crashing. A cheap-to-send payload that reliably produces 500s
is still a denial-of-service vector.

The mitigation is a depth cap at the parse boundary, before the parsed
body reaches the validator. A byte-size limit alone is not enough: a
payload nested thousands of levels deep is tiny, so `express.json({
limit })` (or its equivalent) bounds width, not depth. Walk the parsed
value iteratively (a recursive walker would overflow on the same input
you are trying to reject) and reject anything past a sane ceiling.
Legitimate request bodies rarely nest beyond ten or fifteen levels; a
cap of 32 to 64 is generous for real traffic and well clear of the
danger zone. Set it low and raise it only if a legitimate payload
trips it.

```ts
// Returns true if `value` nests deeper than `limit`. Iterative on
// purpose: a recursive walker would overflow on the input it rejects.
function tooDeep(value: unknown, limit: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (node === null || typeof node !== "object") continue;
    if (depth > limit) return true;
    if (Array.isArray(node)) {
      for (const el of node) stack.push([el, depth + 1]);
    } else {
      for (const k of Object.keys(node)) {
        stack.push([(node as Record<string, unknown>)[k], depth + 1]);
      }
    }
  }
  return false;
}

app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  if (req.body && tooDeep(req.body, 64)) {
    return res.status(400).json({ error: "request body nesting too deep" });
  }
  next();
});
// the validateRequests middleware comes after this guard
```

Fastify is the same shape in an `onRequest` or `preValidation` hook
that inspects `request.body`.

For standalone callers (the Fetch adapter, a handler that calls
`validateRequest` directly), wrap the call so a stack overflow becomes
a controlled error instead of an unhandled rejection:

```ts
try {
  result = validator.validateRequest(req);
} catch (err) {
  if (err instanceof RangeError) {
    return new Response("payload too complex", { status: 400 });
  }
  throw err;
}
```

The depth guard is the primary control; the byte-size limit and the
`try/catch` are backstops.
