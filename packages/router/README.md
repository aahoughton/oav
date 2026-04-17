# @oav/router

Trie-based OpenAPI path matcher. Literal segments beat template segments at
the same depth.

```ts
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

Trailing slashes and query strings are ignored; method matching is
case-insensitive; path segments are percent-decoded.
