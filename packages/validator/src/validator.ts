import {
  createBranchError,
  createLeafError,
  detectOpenAPIVersion,
  type HeaderObject,
  type HttpRequest,
  type HttpResponse,
  type OpenAPIDocument,
  type OpenAPIVersion,
  type OperationObject,
  type ParameterObject,
  type ReferenceObject,
  type RequestBodyObject,
  type ResponseObject,
  type SchemaOrBoolean,
  type ValidationError,
} from "@oav/core";
import { builtInFormats } from "@oav/formats";
import { createRouter, type RouteMatch, type Router } from "@oav/router";
import {
  compileSchema,
  createRefResolver,
  oas30Dialect,
  openapi31Dialect,
  resolve,
  type CompiledSchema,
  type CustomKeywordValidator,
  type Dialect,
  type RefResolver,
} from "@oav/schema";
import { resolveJsonPointer } from "@oav/spec";

/**
 * Pick the dialect for a given OpenAPI version. 3.1 and 3.2 share the
 * 2020-12-based dialect with format-assertion; 3.0 uses the OAS 3.0
 * Schema Object flavour (string-only `type`, `nullable`, boolean
 * `exclusiveMaximum` / `exclusiveMinimum`, `$ref`-suppresses-siblings).
 *
 * @internal
 */
function dialectFor(version: OpenAPIVersion): Dialect {
  switch (version) {
    case "3.1":
    case "3.2":
      return openapi31Dialect;
    case "3.0":
      return oas30Dialect;
  }
}

import { deserialize, matchMediaType, matchResponseKey } from "./deserialize.js";
import { transformBodySchemaForDirection, type BodyDirection } from "./direction.js";

/**
 * The HTTP validator: after being built from a (resolved) OpenAPI document,
 * `validateRequest` / `validateResponse` each return a full
 * {@link ValidationError} tree (or `null`).
 *
 * @public
 */
export interface OavValidator {
  validateRequest(req: HttpRequest): ValidationError | null;
  validateResponse(req: HttpRequest, res: HttpResponse): ValidationError | null;
  /**
   * The OpenAPI version detected from the spec's `openapi` field, or
   * `undefined` when the field was missing/malformed and the validator
   * fell back to its default dialect (see
   * {@link ValidatorOptions.onUnknownVersion}).
   */
  readonly detectedVersion: OpenAPIVersion | undefined;
}

/**
 * Options for {@link createValidator}.
 *
 * @public
 */
export interface ValidatorOptions {
  /** Optional extra format validators merged on top of {@link builtInFormats}. */
  formats?: Record<string, (value: string) => boolean>;
  /** When `true`, reject unknown query parameters (default: `false`). */
  strictQueryParameters?: boolean;
  /**
   * Cap on the number of leaf schema errors collected per
   * `validateRequest` / `validateResponse` call. Defaults to uncapped.
   *
   * Set to `1` for fast-fail semantics, or to a small number (say 10)
   * to bound CPU and memory on validation of very large payloads
   * (e.g. a 10 MB array where every element has the same structural
   * error). When the cap is hit, the returned error tree is marked
   * with a `truncated: true` param on the root so consumers can tell
   * the report was shortened.
   */
  maxErrors?: number;
  /**
   * Override the schema dialect used to compile the spec's schemas.
   * By default the validator reads the spec's `openapi` version and
   * picks a matching built-in dialect (`openapi31Dialect` for 3.1/3.2,
   * `oas30Dialect` for 3.0). Pass this option to plug in a custom
   * {@link Dialect} or force a specific built-in.
   */
  dialect?: Dialect;
  /**
   * User-registered schema keywords. The record is keyed by keyword
   * name; each validator is invoked whenever that name appears in a
   * schema. Keys must not collide with built-in keywords. See
   * {@link CustomKeywordValidator} for the function signature.
   *
   * @example
   * ```ts
   * createValidator(spec, {
   *   keywords: {
   *     divisibleBy: (data, schemaValue) =>
   *       typeof data !== "number" || data % (schemaValue as number) === 0,
   *   },
   * });
   * ```
   */
  keywords?: Record<string, CustomKeywordValidator>;
  /**
   * How to handle a spec whose `openapi` field is missing, malformed,
   * or not one of the supported versions (3.0, 3.1, 3.2).
   *
   * - `"fallback31"` (default) — silently use the 3.1 dialect.
   * - `"warn"` — write a message to `stderr` and use the 3.1 dialect.
   * - `"throw"` — throw an `Error`.
   *
   * Regardless of the choice, `OavValidator.detectedVersion` is set to
   * `undefined` so callers can introspect after the fact.
   */
  onUnknownVersion?: "fallback31" | "warn" | "throw";
}

interface OperationCache {
  pathParamValidators: Map<string, CompiledSchema>;
  queryParamValidators: Map<string, CompiledSchema>;
  headerParamValidators: Map<string, CompiledSchema>;
  cookieParamValidators: Map<string, CompiledSchema>;
  parameters: ParameterObject[];
  requestBody: RequestBodyObject | undefined;
  bodyValidators: Map<string, CompiledSchema>;
  responses: Map<string, ResponseCompiled>;
}

interface ResponseCompiled {
  object: ResponseObject;
  /** Keyed by lowercased header name; value preserves the spec-cased name. */
  headers: Map<string, { name: string; object: HeaderObject }>;
  /**
   * Response body schemas, keyed by media type. Each is compiled lazily
   * on first use and memoized into `bodyValidators`. Eager compilation
   * of every response schema at `cacheFor` time is expensive on specs
   * with hundreds of operations (Stripe-shaped), and most validators
   * are only ever asked about a single status/media-type pairing.
   */
  bodySchemas: Map<string, SchemaOrBoolean>;
  /** Header schemas keyed by lowercased name; compiled lazily. */
  headerSchemas: Map<string, SchemaOrBoolean>;
  /** Memoization caches for the lazy compiles. */
  bodyValidators: Map<string, CompiledSchema>;
  headerValidators: Map<string, CompiledSchema>;
}

/**
 * Build an {@link OavValidator} from a resolved OpenAPI 3.1 document.
 *
 * @param spec - The fully-resolved OpenAPI document (no external `$ref`s).
 * @param options - Optional formats / strict-mode settings.
 * @returns A validator that can check individual requests and responses.
 *
 * @example
 * ```ts
 * const v = createValidator(resolvedSpec);
 * const err = v.validateRequest({ method: "POST", path: "/pets", body: {...} });
 * ```
 *
 * @public
 */
export function createValidator(
  spec: OpenAPIDocument,
  options: ValidatorOptions = {},
): OavValidator {
  const paths = spec.paths ?? {};
  const router: Router = createRouter(paths);
  const formats = { ...builtInFormats, ...options.formats };

  // Version detection is pure compile-time: we bake the right
  // dialect into the compiled validator and never branch on version
  // per request.
  const detectedVersion = detectOpenAPIVersion(spec);
  const dialect: Dialect = (() => {
    if (options.dialect !== undefined) return options.dialect;
    if (detectedVersion === undefined) {
      const policy = options.onUnknownVersion ?? "fallback31";
      if (policy === "throw") {
        throw new Error(
          "createValidator: spec has a missing or unsupported `openapi` field; set onUnknownVersion to 'warn' or 'fallback31' to accept it",
        );
      }
      if (policy === "warn") {
        process.stderr.write(
          "createValidator: spec has a missing or unsupported `openapi` field; falling back to the 3.1 dialect\n",
        );
      }
      return openapi31Dialect;
    }
    return dialectFor(detectedVersion);
  })();

  const graph = resolve(spec as unknown as SchemaOrBoolean);
  const refResolver: RefResolver = createRefResolver(graph);

  const compiledCache = new Map<SchemaOrBoolean, CompiledSchema>();
  const compile = (schema: SchemaOrBoolean): CompiledSchema => {
    const cached = compiledCache.get(schema);
    if (cached !== undefined) return cached;
    const c = compileSchema(schema, {
      dialect,
      formats,
      refResolver,
      maxErrors: options.maxErrors,
      keywords: options.keywords,
    });
    compiledCache.set(schema, c);
    return c;
  };

  // Per-direction transform caches: readOnly/writeOnly are direction-
  // sensitive, so the same schema object produces two differently-clipped
  // clones (one with readOnly properties forbidden, one with writeOnly).
  // Keyed by the original schema identity; reused across operations.
  const directionTransformCache = {
    request: new Map<SchemaOrBoolean, SchemaOrBoolean>(),
    response: new Map<SchemaOrBoolean, SchemaOrBoolean>(),
  };
  const compileForDirection = (schema: SchemaOrBoolean, direction: BodyDirection): CompiledSchema =>
    compile(
      transformBodySchemaForDirection(
        schema,
        direction,
        refResolver,
        directionTransformCache[direction],
      ),
    );

  // Look up a response-side validator, compiling on first access and
  // memoizing into the passed cache. Shared by body and header paths.
  // `direction` controls readOnly/writeOnly enforcement: response bodies
  // get the "response" transform (writeOnly properties forbidden);
  // response headers are direction-agnostic.
  const getResponseValidator = (
    cache: Map<string, CompiledSchema>,
    schemas: Map<string, SchemaOrBoolean>,
    key: string,
    direction?: BodyDirection,
  ): CompiledSchema | undefined => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const schema = schemas.get(key);
    if (schema === undefined) return undefined;
    const c = direction === undefined ? compile(schema) : compileForDirection(schema, direction);
    cache.set(key, c);
    return c;
  };

  // Resolve an operation-level $ref (requestBody, response, parameter,
  // header) against the spec. Returns the target object with any
  // siblings on the reference itself dropped — per OAS, siblings of a
  // Reference are ignored. Follows ref chains with a depth guard.
  // External refs must be inlined upstream by @oav/spec.resolveSpec().
  const resolveRef = <T>(value: T | ReferenceObject | undefined): T | undefined => {
    let current: unknown = value;
    for (let hops = 0; hops < 32; hops++) {
      if (current === undefined || current === null || typeof current !== "object") {
        return current as T | undefined;
      }
      const ref = (current as ReferenceObject).$ref;
      if (typeof ref !== "string") return current as T;
      if (!ref.startsWith("#")) {
        throw new Error(
          `external ref "${ref}" not resolved; run @oav/spec's resolveSpec() over the document before passing it to createValidator()`,
        );
      }
      current = resolveJsonPointer(spec, ref.slice(1));
    }
    throw new Error(`$ref chain exceeded 32 hops (possible cycle)`);
  };

  const operationCache = new WeakMap<OperationObject, OperationCache>();

  const cacheFor = (pathMatch: RouteMatch): OperationCache => {
    const existing = operationCache.get(pathMatch.operation);
    if (existing !== undefined) return existing;

    const rawParams: (ParameterObject | ReferenceObject)[] = [
      ...(pathMatch.pathItem.parameters ?? []),
      ...(pathMatch.operation.parameters ?? []),
    ];
    const parameters: ParameterObject[] = [];
    for (const p of rawParams) {
      const resolved = resolveRef<ParameterObject>(p);
      if (resolved !== undefined) parameters.push(resolved);
    }

    const pathParamValidators = new Map<string, CompiledSchema>();
    const queryParamValidators = new Map<string, CompiledSchema>();
    const headerParamValidators = new Map<string, CompiledSchema>();
    const cookieParamValidators = new Map<string, CompiledSchema>();

    for (const p of parameters) {
      const contentSchema = firstContentSchema(p);
      const schema = contentSchema ?? p.schema;
      if (schema === undefined) continue;
      const v = compile(schema);
      const target =
        p.in === "path"
          ? pathParamValidators
          : p.in === "query"
            ? queryParamValidators
            : p.in === "header"
              ? headerParamValidators
              : cookieParamValidators;
      target.set(p.name, v);
    }

    const bodyValidators = new Map<string, CompiledSchema>();
    const requestBody = resolveRef<RequestBodyObject>(pathMatch.operation.requestBody);
    if (requestBody?.content) {
      for (const [mt, mto] of Object.entries(requestBody.content)) {
        if (mto.schema) bodyValidators.set(mt, compileForDirection(mto.schema, "request"));
      }
    }

    const responses = new Map<string, ResponseCompiled>();
    const rawResponses = pathMatch.operation.responses ?? {};
    for (const [status, rawResponse] of Object.entries(rawResponses)) {
      const response = resolveRef<ResponseObject>(rawResponse);
      if (response === undefined) continue;
      const bodySchemas = new Map<string, SchemaOrBoolean>();
      const headerSchemas = new Map<string, SchemaOrBoolean>();
      const headersResolved = new Map<string, { name: string; object: HeaderObject }>();
      for (const [mt, mto] of Object.entries(response.content ?? {})) {
        if (mto.schema) bodySchemas.set(mt, mto.schema);
      }
      for (const [name, rawHdr] of Object.entries(response.headers ?? {})) {
        const hdr = resolveRef<HeaderObject>(rawHdr);
        if (hdr === undefined) continue;
        const lower = name.toLowerCase();
        headersResolved.set(lower, { name, object: hdr });
        if (hdr.schema) headerSchemas.set(lower, hdr.schema);
      }
      responses.set(status, {
        object: response,
        headers: headersResolved,
        bodySchemas,
        headerSchemas,
        bodyValidators: new Map(),
        headerValidators: new Map(),
      });
    }

    const cache: OperationCache = {
      parameters,
      pathParamValidators,
      queryParamValidators,
      headerParamValidators,
      cookieParamValidators,
      requestBody,
      bodyValidators,
      responses,
    };
    operationCache.set(pathMatch.operation, cache);
    return cache;
  };

  const validateRequest = (req: HttpRequest): ValidationError | null => {
    const match = router.match(req.method, req.path);
    if (match === undefined) {
      return createLeafError(
        "route",
        [],
        `no route matches ${req.method.toUpperCase()} ${req.path}`,
        { method: req.method, path: req.path },
      );
    }
    const cache = cacheFor(match);
    const children: ValidationError[] = [];

    for (const p of cache.parameters) {
      const err = validateParameter(p, req, match, cache);
      if (err !== null) children.push(err);
    }

    if (cache.requestBody !== undefined) {
      const err = validateBody(req, cache);
      if (err !== null) children.push(err);
    }

    if (options.strictQueryParameters && req.query) {
      const known = new Set(cache.parameters.filter((p) => p.in === "query").map((p) => p.name));
      for (const key of Object.keys(req.query)) {
        if (!known.has(key)) {
          children.push(
            createLeafError("query-param", ["query", key], `unknown query parameter "${key}"`, {
              name: key,
            }),
          );
        }
      }
    }

    if (children.length === 0) return null;
    return createBranchError(
      "request",
      [],
      `${req.method.toUpperCase()} ${match.pathPattern}: request validation failed`,
      children,
      { method: req.method, pathPattern: match.pathPattern },
    );
  };

  const validateResponse = (req: HttpRequest, res: HttpResponse): ValidationError | null => {
    const match = router.match(req.method, req.path);
    if (match === undefined) {
      return createLeafError(
        "route",
        [],
        `no route matches ${req.method.toUpperCase()} ${req.path}`,
        { method: req.method, path: req.path },
      );
    }
    const cache = cacheFor(match);
    const children: ValidationError[] = [];

    const statusKey = matchResponseKey(res.status, Object.fromEntries(cache.responses));
    if (statusKey === undefined) {
      children.push(
        createLeafError("status", ["response"], `no response defined for status ${res.status}`, {
          status: res.status,
        }),
      );
    } else {
      const responseCompiled = cache.responses.get(statusKey);
      if (responseCompiled !== undefined) {
        if (res.headers && responseCompiled.headers.size > 0) {
          for (const [lowered, entry] of responseCompiled.headers) {
            const hdr = entry.object;
            const name = entry.name;
            const raw = res.headers[lowered] ?? res.headers[name];
            if (hdr.required && (raw === undefined || raw === "")) {
              children.push(
                createLeafError(
                  "header-param",
                  ["response", "headers", name],
                  `missing required header "${name}"`,
                  {
                    name,
                  },
                ),
              );
              continue;
            }
            if (raw === undefined) continue;
            const validator = getResponseValidator(
              responseCompiled.headerValidators,
              responseCompiled.headerSchemas,
              lowered,
            );
            if (validator === undefined) continue;
            const value = deserialize(raw, {
              name,
              in: "header",
              schema: hdr.schema,
              style: hdr.style,
              explode: hdr.explode,
            });
            const r = validator.validate(value, ["response", "headers", name]);
            if (!r.valid && r.error !== undefined) {
              children.push(r.error);
            }
          }
        }

        if (responseCompiled.bodySchemas.size > 0 && res.body !== undefined) {
          const mt = matchMediaType(res.contentType, responseCompiled.bodySchemas.keys());
          if (mt === undefined) {
            children.push(
              createLeafError(
                "content-type",
                ["response", "body"],
                `response Content-Type "${res.contentType ?? "<missing>"}" is not declared for status ${statusKey}`,
                {
                  contentType: res.contentType,
                  declared: [...responseCompiled.bodySchemas.keys()],
                },
              ),
            );
          } else {
            const validator = getResponseValidator(
              responseCompiled.bodyValidators,
              responseCompiled.bodySchemas,
              mt,
              "response",
            );
            if (validator !== undefined) {
              const r = validator.validate(res.body, ["response", "body"]);
              if (!r.valid && r.error !== undefined) {
                children.push(r.error);
              }
            }
          }
        }
      }
    }

    if (children.length === 0) return null;
    return createBranchError(
      "response",
      [],
      `${req.method.toUpperCase()} ${match.pathPattern}: response validation failed`,
      children,
      { status: res.status },
    );
  };

  return { validateRequest, validateResponse, detectedVersion };
}

function validateParameter(
  p: ParameterObject,
  req: HttpRequest,
  match: RouteMatch,
  cache: OperationCache,
): ValidationError | null {
  let raw: string | string[] | undefined;
  let validator: CompiledSchema | undefined;
  let pathPrefix: (string | number)[];
  let code: string;

  switch (p.in) {
    case "path":
      raw = match.pathParams[p.name];
      validator = cache.pathParamValidators.get(p.name);
      pathPrefix = ["path", p.name];
      code = "path-param";
      break;
    case "query":
      raw = req.query?.[p.name];
      validator = cache.queryParamValidators.get(p.name);
      pathPrefix = ["query", p.name];
      code = "query-param";
      break;
    case "header":
      raw = req.headers?.[p.name.toLowerCase()] ?? req.headers?.[p.name];
      validator = cache.headerParamValidators.get(p.name);
      pathPrefix = ["header", p.name];
      code = "header-param";
      break;
    case "cookie":
      raw = req.cookies?.[p.name];
      validator = cache.cookieParamValidators.get(p.name);
      pathPrefix = ["cookie", p.name];
      code = "cookie-param";
      break;
  }

  if (raw === undefined) {
    if (p.required) {
      return createLeafError(code, pathPrefix, `missing required ${p.in} parameter "${p.name}"`, {
        name: p.name,
        in: p.in,
      });
    }
    return null;
  }
  // Empty-string is a legitimate value — `minLength`/`pattern` on the
  // parameter schema handles rejection where needed. OpenAPI 3.1 §4.8.12.1
  // explicitly permits `?flag=` on query parameters declaring
  // `allowEmptyValue: true`; exempt those from validation.
  if (raw === "" && p.in === "query" && p.allowEmptyValue === true) return null;
  if (validator === undefined) return null;

  // `parameter.content` takes precedence over `parameter.schema` when both
  // are present. Spec permits exactly one media-type entry; take it.
  // For JSON media types, parse the raw string before validating; other
  // types (text/plain, etc.) are passed through as the raw string.
  const contentMediaType = firstContentMediaType(p);
  if (contentMediaType !== undefined) {
    const rawStr = Array.isArray(raw) ? raw[0] : raw;
    if (typeof rawStr !== "string") return null;
    let parsed: unknown = rawStr;
    if (isJsonMediaType(contentMediaType)) {
      try {
        parsed = JSON.parse(rawStr);
      } catch (err) {
        return createLeafError(
          code,
          pathPrefix,
          `${p.in} parameter "${p.name}" is not valid ${contentMediaType}: ${(err as Error).message}`,
          { name: p.name, in: p.in, mediaType: contentMediaType, reason: "content-parse" },
        );
      }
    }
    const r = validator.validate(parsed, pathPrefix);
    if (r.valid || r.error === undefined) return null;
    return r.error;
  }

  const value = deserialize(raw, p);
  const r = validator.validate(value, pathPrefix);
  if (r.valid || r.error === undefined) return null;
  return r.error;
}

function firstContentSchema(p: ParameterObject): SchemaOrBoolean | undefined {
  if (p.content === undefined) return undefined;
  for (const mto of Object.values(p.content)) {
    if (mto.schema !== undefined) return mto.schema;
  }
  return undefined;
}

function firstContentMediaType(p: ParameterObject): string | undefined {
  if (p.content === undefined) return undefined;
  for (const [mt, mto] of Object.entries(p.content)) {
    if (mto.schema !== undefined) return mt;
  }
  return undefined;
}

function isJsonMediaType(mediaType: string): boolean {
  const base = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "application/json" || base.endsWith("+json");
}

function validateBody(req: HttpRequest, cache: OperationCache): ValidationError | null {
  const body = cache.requestBody;
  if (body === undefined) return null;
  const hasBody = req.body !== undefined && req.body !== null;
  if (!hasBody) {
    if (body.required) {
      return createLeafError("body", ["body"], "missing required request body", {});
    }
    return null;
  }
  if (cache.bodyValidators.size === 0) return null;
  const mt = matchMediaType(req.contentType, cache.bodyValidators.keys());
  if (mt === undefined) {
    return createLeafError(
      "content-type",
      ["body"],
      `request Content-Type "${req.contentType ?? "<missing>"}" is not accepted`,
      { contentType: req.contentType, accepted: [...cache.bodyValidators.keys()] },
    );
  }
  const validator = cache.bodyValidators.get(mt);
  if (validator === undefined) return null;
  const r = validator.validate(req.body, ["body"]);
  if (r.valid || r.error === undefined) return null;
  return r.error;
}
