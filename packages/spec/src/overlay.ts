import type {
  HttpMethod,
  OpenAPIDocument,
  OperationObject,
  ParameterObject,
  PathItem,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
} from "@oav/core";

/**
 * Per-operation override recipe used inside {@link SpecOverlay.overrides}.
 *
 * @public
 */
export interface PathOverride {
  /** HTTP method → operation fragment. Keys are lowercase. */
  operations?: Partial<Record<HttpMethod, OperationOverride>>;
  /** Fields on the PathItem itself (e.g. `parameters`) to merge. */
  pathItem?: Partial<PathItem>;
}

/**
 * Recipe for merging into a single {@link OperationObject}.
 *
 * @public
 */
export interface OperationOverride {
  /** Parameters to add/replace. Replacement is by (`name`, `in`) pair. */
  addParameters?: ParameterObject[];
  /** Replace the request body entirely. */
  requestBody?: RequestBodyObject;
  /** Merge-by-key (status code) into responses. */
  responses?: Record<string, ResponseObject>;
}

/**
 * A spec overlay: instructions to patch the base OpenAPI document. Overlays
 * apply in order; later overlays win on conflict.
 *
 * @public
 */
export interface SpecOverlay {
  addPaths?: Record<string, PathItem>;
  overrides?: Record<string, PathOverride>;
  extendSchemas?: Record<string, SchemaObject>;
  replaceSchemas?: Record<string, SchemaObject>;
}

const METHODS: HttpMethod[] = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/**
 * Apply a sequence of overlays to a base OpenAPI document, returning a new
 * document. Does not mutate the input.
 *
 * @param base - The base (resolved) OpenAPI document.
 * @param overlays - Overlays to apply in order.
 * @returns The patched document.
 * @throws On conflicts that the overlay semantics do not know how to merge.
 *
 * @example
 * ```ts
 * const patched = applyOverlays(spec, [overlay1, overlay2]);
 * ```
 *
 * @public
 */
export function applyOverlays(base: OpenAPIDocument, overlays: SpecOverlay[]): OpenAPIDocument {
  let doc: OpenAPIDocument = structuredClone(base);
  for (const overlay of overlays) doc = applyOverlay(doc, overlay);
  return doc;
}

function applyOverlay(doc: OpenAPIDocument, overlay: SpecOverlay): OpenAPIDocument {
  const next: OpenAPIDocument = { ...doc };

  if (overlay.addPaths) {
    const paths: Record<string, PathItem> = { ...next.paths };
    for (const [path, item] of Object.entries(overlay.addPaths)) {
      if (paths[path] !== undefined) {
        throw new Error(`overlay conflict: path ${path} already exists in the base document`);
      }
      paths[path] = item;
    }
    next.paths = paths;
  }

  if (overlay.overrides) {
    const paths: Record<string, PathItem> = { ...next.paths };
    for (const [pathPattern, override] of Object.entries(overlay.overrides)) {
      const matches = pathPattern === "*" ? Object.keys(paths) : [pathPattern];
      for (const path of matches) {
        const item = paths[path];
        if (item === undefined) {
          throw new Error(`overlay override targets unknown path ${path}`);
        }
        paths[path] = applyPathOverride(item, override);
      }
    }
    next.paths = paths;
  }

  if (overlay.extendSchemas || overlay.replaceSchemas) {
    const components = { ...next.components };
    const schemas: Record<string, SchemaObject> = {
      ...((components.schemas ?? {}) as Record<string, SchemaObject>),
    };
    for (const [name, extension] of Object.entries(overlay.extendSchemas ?? {})) {
      const existing = schemas[name];
      if (existing === undefined) {
        schemas[name] = extension;
      } else {
        schemas[name] = { allOf: [existing, extension] };
      }
    }
    for (const [name, replacement] of Object.entries(overlay.replaceSchemas ?? {})) {
      schemas[name] = replacement;
    }
    components.schemas = schemas;
    next.components = components;
  }

  return next;
}

function applyPathOverride(item: PathItem, override: PathOverride): PathItem {
  const next: PathItem = { ...item };
  if (override.pathItem) Object.assign(next, override.pathItem);
  if (override.operations) {
    const methods =
      "*" in override.operations ? METHODS : (Object.keys(override.operations) as HttpMethod[]);
    for (const method of methods) {
      const opOverride =
        override.operations[method as HttpMethod] ??
        (override.operations as Record<string, OperationOverride | undefined>)["*"];
      if (opOverride === undefined) continue;
      const op = next[method];
      if (op === undefined) continue;
      next[method] = applyOperationOverride(op, opOverride);
    }
  }
  return next;
}

function applyOperationOverride(op: OperationObject, override: OperationOverride): OperationObject {
  const next: OperationObject = { ...op };
  if (override.addParameters) {
    const existing = [...(op.parameters ?? [])];
    for (const newParam of override.addParameters) {
      const idx = existing.findIndex((p) => p.name === newParam.name && p.in === newParam.in);
      if (idx >= 0) existing[idx] = newParam;
      else existing.push(newParam);
    }
    next.parameters = existing;
  }
  if (override.requestBody) next.requestBody = override.requestBody;
  if (override.responses) {
    next.responses = { ...op.responses, ...override.responses };
  }
  return next;
}
