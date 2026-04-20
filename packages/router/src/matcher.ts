import type { HttpMethod, OperationObject, PathItem } from "@oav/core";

/**
 * Segments of a parsed OpenAPI path template.
 *
 * @public
 */
export type Segment = { kind: "literal"; value: string } | { kind: "template"; name: string };

/**
 * Result of a successful route match.
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
  operation: OperationObject;
  pathItem: PathItem;
  pathPattern: string;
  pathParams: Record<string, string>;
}

/**
 * The router interface. Returns `undefined` for unmatched routes.
 *
 * @public
 */
export interface Router {
  match(method: string, path: string): RouteMatch | undefined;
}

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
  for (const [pattern, item] of Object.entries(paths)) {
    routes.push({ segments: parseTemplate(pattern), pathPattern: pattern, pathItem: item });
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
        if (operation === undefined) continue;
        return {
          operation,
          pathItem: route.pathItem,
          pathPattern: route.pathPattern,
          pathParams: params,
        };
      }
      return undefined;
    },
  };
}
