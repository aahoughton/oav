import type {
  HttpMethod,
  OpenAPIDocument,
  OperationObject,
  ParameterLocation,
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
 * Recipe for patching a single {@link OperationObject}. Each field is
 * independent; use any subset. Supported verbs across the patchable
 * slots are summarised below.
 *
 * Conflict rules applied by {@link applyOverlays}:
 * - `replace` is wholesale and cannot be combined with the additive /
 *   removal fields below. Setting both throws at apply time.
 * - `removeParameters` / `removeResponses` silently no-op when the
 *   target isn't present; wildcard overrides (`"*"`) fan out to many
 *   operations and can't assume every target has the same surface.
 *
 * @public
 */
export interface OperationOverride {
  /** Replace the whole OperationObject. Mutually exclusive with the additive / remove fields. */
  replace?: OperationObject;
  /**
   * Add-or-replace parameters by (`name`, `in`). Existing entries with
   * the same key are overwritten; anything else appends.
   * Reference-object entries (`{ $ref: … }`) in the base can't be
   * matched without resolution, so new parameters with the same key
   * append alongside them rather than replacing.
   */
  upsertParameters?: ParameterObject[];
  /** Remove parameters by (`name`, `in`). Silent no-op on missing entries. */
  removeParameters?: Array<{ name: string; in: ParameterLocation }>;
  /** Replace the request body entirely. */
  requestBody?: RequestBodyObject;
  /** Merge-by-status-code into responses. Status codes present in both base and override take the override. */
  responses?: Record<string, ResponseObject>;
  /** Remove response status codes. Silent no-op on missing entries. */
  removeResponses?: string[];
}

/**
 * A spec overlay: instructions to patch the base OpenAPI document.
 * Overlays apply in order; later overlays win on conflict.
 *
 * @public
 */
export interface SpecOverlay {
  /** Add new paths. Throws if a target path already exists in the base document. */
  addPaths?: Record<string, PathItem>;
  /** Remove paths. Throws if a target path isn't present in the base document. */
  removePaths?: string[];
  /** Per-path modifications; see {@link PathOverride}. */
  overrides?: Record<string, PathOverride>;
  /** Extend a component schema via `allOf` (original + extension both apply). */
  extendSchemas?: Record<string, SchemaObject>;
  /** Replace a component schema wholesale. */
  replaceSchemas?: Record<string, SchemaObject>;
  /** Remove component schemas. Throws if a target schema isn't present. */
  removeSchemas?: string[];
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
  assertNoSelfConflict(overlay);
  const next: OpenAPIDocument = { ...doc };
  const paths: Record<string, PathItem> = { ...next.paths };
  let pathsChanged = false;

  if (overlay.addPaths) {
    for (const [path, item] of Object.entries(overlay.addPaths)) {
      if (paths[path] !== undefined) {
        throw new Error(`overlay conflict: path ${path} already exists in the base document`);
      }
      paths[path] = item;
      pathsChanged = true;
    }
  }

  if (overlay.removePaths) {
    for (const path of overlay.removePaths) {
      if (paths[path] === undefined) {
        throw new Error(`overlay removePaths targets unknown path ${path}`);
      }
      delete paths[path];
      pathsChanged = true;
    }
  }

  if (overlay.overrides) {
    for (const [pathPattern, override] of Object.entries(overlay.overrides)) {
      const matches = pathPattern === "*" ? Object.keys(paths) : [pathPattern];
      for (const path of matches) {
        const item = paths[path];
        if (item === undefined) {
          throw new Error(`overlay override targets unknown path ${path}`);
        }
        paths[path] = applyPathOverride(item, override);
        pathsChanged = true;
      }
    }
  }

  if (pathsChanged) next.paths = paths;

  if (overlay.extendSchemas || overlay.replaceSchemas || overlay.removeSchemas) {
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
    for (const name of overlay.removeSchemas ?? []) {
      if (schemas[name] === undefined) {
        throw new Error(`overlay removeSchemas targets unknown schema ${name}`);
      }
      delete schemas[name];
    }
    components.schemas = schemas;
    next.components = components;
  }

  return next;
}

/**
 * Hard-reject overlays whose own fields contradict each other before
 * we start mutating anything. A contradictory overlay is almost
 * certainly a consumer bug, and silently picking a winner would hide
 * it; surfacing the conflict with a location message is cheaper.
 */
function assertNoSelfConflict(overlay: SpecOverlay): void {
  if (overlay.addPaths && overlay.removePaths) {
    for (const p of overlay.removePaths) {
      if (p in overlay.addPaths) {
        throw new Error(`overlay self-conflict: addPaths and removePaths both name ${p}`);
      }
    }
  }
  if (overlay.replaceSchemas && overlay.removeSchemas) {
    for (const name of overlay.removeSchemas) {
      if (name in overlay.replaceSchemas) {
        throw new Error(
          `overlay self-conflict: replaceSchemas and removeSchemas both name ${name}`,
        );
      }
    }
  }
  if (overlay.extendSchemas && overlay.removeSchemas) {
    for (const name of overlay.removeSchemas) {
      if (name in overlay.extendSchemas) {
        throw new Error(`overlay self-conflict: extendSchemas and removeSchemas both name ${name}`);
      }
    }
  }
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
  if (override.replace !== undefined) {
    for (const key of [
      "upsertParameters",
      "removeParameters",
      "requestBody",
      "responses",
      "removeResponses",
    ] as const) {
      if (override[key] !== undefined) {
        throw new Error(
          `overlay conflict: OperationOverride.replace cannot be combined with ${key}`,
        );
      }
    }
    return override.replace;
  }

  const next: OperationObject = { ...op };
  if (override.upsertParameters) {
    const existing = [...(op.parameters ?? [])];
    for (const newParam of override.upsertParameters) {
      // Reference-object entries (`{ $ref: … }`) can't be matched by
      // (name, in) without resolving them; overlays apply pre-resolve
      // so we just skip matching against refs and append / overwrite
      // against concrete entries.
      const idx = existing.findIndex(
        (p) => "name" in p && p.name === newParam.name && p.in === newParam.in,
      );
      if (idx >= 0) existing[idx] = newParam;
      else existing.push(newParam);
    }
    next.parameters = existing;
  }
  if (override.removeParameters) {
    const existing = next.parameters ?? op.parameters ?? [];
    const filtered = existing.filter(
      (p) =>
        !("name" in p) ||
        !override.removeParameters!.some((r) => r.name === p.name && r.in === p.in),
    );
    if (filtered.length !== existing.length) next.parameters = filtered;
  }
  if (override.requestBody) next.requestBody = override.requestBody;
  if (override.responses) {
    next.responses = { ...op.responses, ...override.responses };
  }
  if (override.removeResponses) {
    const source = next.responses ?? op.responses ?? {};
    const copy: Record<string, (typeof source)[string]> = { ...source };
    let removed = false;
    for (const status of override.removeResponses) {
      if (status in copy) {
        delete copy[status];
        removed = true;
      }
    }
    if (removed) next.responses = copy;
  }
  return next;
}
