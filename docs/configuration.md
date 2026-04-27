# Configuring the validator

`createValidator(spec, options)` accepts the options below. The
canonical reference is the
[`ValidatorOptions`](../packages/validator/src/validator.ts) TSDoc;
this page is a recipe-oriented overview.

| Option                  | Effect                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `dialect`               | Force a specific schema dialect, bypassing version detection.                                                                         |
| `formats`               | Extra string format validators merged on top of the built-ins.                                                                        |
| `keywords`              | Register user-defined schema keywords (see below).                                                                                    |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail, default is uncapped.                                                                            |
| `strict`                | Compile-time schema lint mode: `"off"`, `"warn-partial"` (default), or `"strict"`. Issues surface via `validator.stats.strictIssues`. |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.                                                                                  |
| `validateSecurity`      | Shape-only security check (bearer / basic / apiKey). Default `false` (auth middleware runs upstream); set `true` to opt in.           |
| `ignoreUndocumented`    | Return `null` on requests whose path the router can't match. Default `false`.                                                         |
| `ignorePaths`           | Predicate `(path) => boolean`; returning `true` short-circuits validation to `null` before routing.                                   |
| `onUnknownVersion`      | Policy for specs with missing/unsupported `openapi`: `"fallback31"` (default), `"warn"`, or `"throw"`.                                |

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
