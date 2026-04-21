import type { HttpMethod, OperationObject, PathItem } from "@oav/core";

/**
 * Segments of a parsed OpenAPI path template.
 *
 * @public
 */
export type Segment = { kind: "literal"; value: string } | { kind: "template"; name: string };

/**
 * Result of a successful route match: the path template matched *and*
 * the requested method is declared on it.
 *
 * `operation` and `pathItem` are the identical references supplied to
 * {@link createRouter}. Downstream consumers (notably `@oav/validator`)
 * key per-operation caches on `operation`'s object identity via
 * `WeakMap`, so any future router change must preserve that identity —
 * do not clone, merge, or otherwise reconstruct these references.
 *
 * @public
 */
export interface RouteMatch {
  kind: "match";
  operation: OperationObject;
  pathItem: PathItem;
  pathPattern: string;
  pathParams: Record<string, string>;
}

/**
 * Result returned when the path template matched but the requested
 * method isn't declared on it. Semantically a 405 Method Not Allowed
 * rather than a 404. `allowed` is the union of HTTP methods declared
 * across every path template that matched the request path, uppercased
 * — suitable for an RFC 9110 `Allow` response header.
 *
 * @public
 */
export interface MethodNotAllowed {
  kind: "method-not-allowed";
  /** The most specific path template that matched. */
  pathPattern: string;
  /** Uppercased HTTP methods declared on matching path(s). */
  allowed: string[];
}

/**
 * The router interface. `match` returns:
 *
 * - `RouteMatch` — the path matched and the method is declared on it.
 * - `MethodNotAllowed` — the path matched but no declared method
 *   handles the request's verb. Callers map this to HTTP 405.
 * - `undefined` — no path template matched at all. Callers map this
 *   to HTTP 404.
 *
 * @public
 */
export interface Router {
  match(method: string, path: string): RouteMatch | MethodNotAllowed | undefined;
}

// HTTP methods to scan on a `PathItem` when collecting `allowed` for a
// 405 response. Mirrors the `HttpMethod` union in @oav/core; kept local
// here to avoid pulling an extra symbol across the package boundary
// for a constant array.
const ALL_METHODS: HttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
];

interface Route {
  segments: Segment[];
  pathPattern: string;
  pathItem: PathItem;
}

/**
 * Parse an OpenAPI path template into segments.
 *
 * @param template - The path template (e.g. `"/pets/{petId}"`).
 * @returns An array of literal/template segments.
 *
 * @example
 * ```ts
 * parseTemplate("/pets/{id}"); // [{literal "pets"}, {template "id"}]
 * ```
 *
 * @public
 */
export function parseTemplate(template: string): Segment[] {
  const trimmed = template.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return [];
  return trimmed.split("/").map((seg): Segment => {
    if (seg.startsWith("{") && seg.endsWith("}")) {
      return { kind: "template", name: seg.slice(1, -1) };
    }
    return { kind: "literal", value: decodeURIComponent(seg) };
  });
}

/**
 * Build a router from a map of `pathTemplate → PathItem`. Paths with more
 * literal (non-template) segments win over more template-heavy siblings;
 * the route list is sorted once at construction, then each `match` call is
 * a linear scan — O(routes × segments). That is cheap for the route counts
 * typical in OpenAPI specs (tens to low hundreds); swap in a proper radix
 * tree here if you're routing thousands of paths.
 *
 * @param paths - Record of path templates to PathItems.
 * @returns A {@link Router}.
 *
 * @example
 * ```ts
 * const router = createRouter({
 *   "/pets/{id}": { get: {...} },
 *   "/pets/mine": { get: {...} },
 * });
 * router.match("get", "/pets/mine");   // hits "mine"
 * router.match("get", "/pets/42");     // hits {id}
 * ```
 *
 * @public
 */
export function createRouter(paths: Record<string, PathItem>): Router {
  const routes: Route[] = [];
  const bySignature = new Map<string, string>();
  for (const [pattern, item] of Object.entries(paths)) {
    const segments = parseTemplate(pattern);
    // Detect routes that are structurally identical except for template
    // parameter names — e.g. `/items/{id}` vs `/items/{slug}`. These are
    // an ill-formed document per OAS (two paths that would always match
    // the same request), so surface that at construction rather than
    // silently dropping every request into whichever sort order wins.
    const signature = segments.map((s) => (s.kind === "literal" ? s.value : "\0{}")).join("/");
    const existing = bySignature.get(signature);
    if (existing !== undefined) {
      throw new Error(
        `createRouter: path templates "${existing}" and "${pattern}" are ambiguous — they differ only in parameter names. Rename one or merge them.`,
      );
    }
    bySignature.set(signature, pattern);
    routes.push({ segments, pathPattern: pattern, pathItem: item });
  }
  // Sort by specificity: more literal segments win, longer paths win on ties.
  routes.sort((a, b) => {
    const aLit = a.segments.filter((s) => s.kind === "literal").length;
    const bLit = b.segments.filter((s) => s.kind === "literal").length;
    if (aLit !== bLit) return bLit - aLit;
    if (a.segments.length !== b.segments.length) return b.segments.length - a.segments.length;
    return a.pathPattern.localeCompare(b.pathPattern);
  });

  return {
    match(method, path) {
      const normMethod = method.toLowerCase() as HttpMethod;
      const stripped = path.split("?")[0] ?? path;
      const trimmed = stripped.replace(/^\/+/, "").replace(/\/+$/, "");
      const tokens = trimmed === "" ? [] : trimmed.split("/").map((s) => decodeURIComponent(s));

      // If we scan every matching path without finding the method, we
      // still want to report a 405 (not 404) and carry the union of
      // declared methods across every path that matched structurally.
      // `/items/42` and `/items/{id}` can both match `POST /items/42`
      // even though neither declares POST.
      let firstMatchedPattern: string | undefined;
      const allowed = new Set<string>();

      for (const route of routes) {
        if (route.segments.length !== tokens.length) continue;
        const params: Record<string, string> = {};
        let matched = true;
        for (let i = 0; i < tokens.length; i += 1) {
          const seg = route.segments[i];
          const tok = tokens[i];
          if (seg === undefined || tok === undefined) {
            matched = false;
            break;
          }
          if (seg.kind === "literal") {
            if (seg.value !== tok) {
              matched = false;
              break;
            }
          } else {
            params[seg.name] = tok;
          }
        }
        if (!matched) continue;
        let operation = route.pathItem[normMethod];
        // RFC 9110 §9.3.2: any resource that answers GET must also answer
        // HEAD. OpenAPI authors rarely declare HEAD explicitly, so fall
        // back to the GET operation when no explicit HEAD is present.
        if (operation === undefined && normMethod === "head") {
          operation = route.pathItem.get;
        }
        if (operation !== undefined) {
          return {
            kind: "match",
            operation,
            pathItem: route.pathItem,
            pathPattern: route.pathPattern,
            pathParams: params,
          };
        }

        // Path matched but this path's method map doesn't include the
        // request's verb. Remember the first (most-specific) matched
        // pattern, union the declared methods, and keep scanning.
        if (firstMatchedPattern === undefined) firstMatchedPattern = route.pathPattern;
        for (const m of ALL_METHODS) {
          if (route.pathItem[m] !== undefined) allowed.add(m.toUpperCase());
        }
        // GET implicitly answers HEAD (RFC 9110 §9.3.2).
        if (route.pathItem.get !== undefined) allowed.add("HEAD");
      }

      if (firstMatchedPattern !== undefined) {
        return {
          kind: "method-not-allowed",
          pathPattern: firstMatchedPattern,
          allowed: [...allowed].sort(),
        };
      }
      return undefined;
    },
  };
}
