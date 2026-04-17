# @aahoughton/oav (router)

Trie-based OpenAPI path matcher. Internal dependency of the validator;
exported for tools that want to resolve `method + path` to an operation
without running validation.

Note: the router is not published under its own subpath. Third-party
consumers typically never need it directly — `createValidator` wires it
up. The README is here for contributors navigating the monorepo.

```ts
// Internal usage inside the monorepo
import { createRouter } from "@oav/router";

const router = createRouter({
  "/pets":          { get: {...}, post: {...} },
  "/pets/{id}":     { get: {...} },
  "/pets/mine":     { get: {...} },
});

router.match("GET", "/pets/mine");  // → operation for "/pets/mine"
router.match("GET", "/pets/42");    // → operation for "/pets/{id}", params: { id: "42" }
router.match("POST", "/vets");      // → undefined
```

Literal segments beat template segments at the same depth. Trailing
slashes and query strings are ignored. Method matching is
case-insensitive. Path segments are percent-decoded.

## Identity invariant

`RouteMatch.operation` is the same reference that was supplied to
`createRouter`. The validator keys per-operation caches on this
identity via `WeakMap`, so the router must not clone, merge, or
otherwise reconstruct operations — if you write a custom router,
preserve the spec-provided reference.
