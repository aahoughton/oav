import {
  createBranchError,
  createLeafError,
  detectOpenAPIVersion,
  type HttpRequest,
  type HttpResponse,
  type OpenAPIDocument,
  type OpenAPIVersion,
  type OperationObject,
  type ReferenceObject,
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
import { deserialize, matchMediaType, matchResponseKey } from "./deserialize.js";
import {
  createDirectionResolver,
  transformBodySchemaForDirection,
  type BodyDirection,
} from "./body-schema-transform.js";
import {
  httpRequestFromFetch,
  httpResponseFromFetch,
  type FetchRequestOptions,
} from "./from-fetch.js";
import {
  buildOperationCache,
  resolveOperationRef,
  type OperationCache,
} from "./operation-cache.js";
import { validateBody, validateParameter } from "./validate-step.js";

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
   * Parse a Web Standards {@link Request} and validate it in one call.
   * Convenient for route handlers in frameworks that expose `Request`
   * directly (Next.js App Router, Hono, Bun, Deno) so callers don't
   * repeat ~10 lines of URL / header / body extraction per route.
   *
   * Returns a discriminated union. On success, `body` is the parsed
   * request body, narrowed to the generic type the caller supplies
   * (validation has already confirmed the shape, so the cast is safe
   * in practice). On failure, `error` is the same
   * {@link ValidationError} tree `validateRequest` would return.
   *
   * Body parsing recognises `application/json` (and `*+json`),
   * `application/x-www-form-urlencoded`, `multipart/form-data`
   * (file fields come through as `Uint8Array`), and `text/*`. Any
   * other content type is read as raw bytes; the spec's
   * `format: "binary"` opaque-body bypass accepts it. Override the
   * default reader per-call via {@link FetchRequestOptions.readBody}
   * for streaming, multer-style parsing, or other bespoke handling.
   *
   * @param request - The incoming Web Standards request.
   * @param options - Optional body-reader override.
   * @typeParam T - Declared shape of the parsed body on success.
   *
   * @example
   * ```ts
   * export async function POST(request: Request) {
   *   const r = await validator.validateFetchRequest<CreatePet>(request);
   *   if (!r.ok) return problemResponse(r.error);
   *   // r.body is typed as CreatePet
   * }
   * ```
   */
  validateFetchRequest<T = unknown>(
    request: Request,
    options?: FetchRequestOptions,
  ): Promise<{ ok: true; body: T } | { ok: false; error: ValidationError }>;
  /**
   * Validate a Web Standards {@link Response} against the operation
   * the {@link Request} resolves to. Mirrors
   * {@link validateFetchRequest} for the response side — useful when
   * you're calling an upstream API and want to confirm its response
   * matches the spec, or when you're testing your own handler's
   * output against its OpenAPI contract.
   *
   * Both messages are consumed by this call. The `request` is used
   * only to match the route, method, and path; its body isn't
   * read (and `request.clone()` will give you back a fresh one if
   * you need it after the fact).
   *
   * @param request  - The Web Standards request that triggered `response`.
   * @param response - The Web Standards response to validate.
   * @typeParam T    - Declared shape of the parsed response body on success.
   *
   * @example
   * ```ts
   * const response = await fetch(upstreamUrl, init);
   * const r = await validator.validateFetchResponse<PetList>(req, response);
   * if (!r.ok) log.warn("upstream returned malformed response", r.error);
   * ```
   */
  validateFetchResponse<T = unknown>(
    request: Request,
    response: Response,
  ): Promise<{ ok: true; body: T } | { ok: false; error: ValidationError }>;
  /**
   * The OpenAPI version detected from the spec's `openapi` field, or
   * `undefined` when the field was missing/malformed and the validator
   * fell back to its default dialect (see
   * {@link ValidatorOptions.onUnknownVersion}).
   */
  readonly detectedVersion: OpenAPIVersion | undefined;
  /**
   * Runtime observability for compile-time-specialisation optimisations.
   * The counters live on the validator, not inside a ValidationError
   * tree, so tests can assert on the optimisation directly rather than
   * through indirect signals (throwing test schemas, source grepping).
   */
  readonly stats: ValidatorStats;
}

/**
 * Live counters attached to an {@link OavValidator}.
 *
 * @public
 */
export interface ValidatorStats {
  /**
   * Number of response-body schemas that have been lazily compiled since
   * the validator was constructed. Starts at `0`; bumps by one each time
   * a `(status, mediaType)` pairing is seen by `validateResponse` for
   * the first time. A spec's response bodies are NOT compiled at
   * `createValidator` time, so on a fresh validator this is always `0`.
   */
  responseBodiesCompiled: number;
}

/**
 * Options for {@link createValidator}.
 *
 * @remarks
 * Ordering convention (shared with
 * {@link @aahoughton/oav/schema!CompileOptions}):
 *
 *   1. Compile essentials — `dialect`.
 *   2. Shared extension points — `formats`, `keywords`.
 *   3. Error-collection policy — `maxErrors`.
 *   4. Surface-specific extras last — here, `strictQueryParameters`,
 *      `onUnknownVersion`, `warn`.
 *
 * Options common to both surfaces share names and positions so a
 * reader of one declaration can predict the other. When adding a new
 * option, put it in the section that matches its role and use the
 * same name on the compile-schema side if the concept applies there
 * too.
 *
 * @public
 */
export interface ValidatorOptions {
  // --- 1. Compile essentials ---

  /**
   * Override the schema dialect used to compile the spec's schemas.
   * By default the validator reads the spec's `openapi` version and
   * picks a matching built-in dialect (`openapi31Dialect` for 3.1/3.2,
   * `oas30Dialect` for 3.0). Pass this option to plug in a custom
   * {@link Dialect} or force a specific built-in.
   */
  dialect?: Dialect;

  // --- 2. Shared extension points ---

  /** Optional extra format validators merged on top of {@link builtInFormats}. */
  formats?: Record<string, (value: string) => boolean>;
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

  // --- 3. Error-collection policy ---

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

  // --- 4. HTTP-validator-specific extras ---

  /** When `true`, reject unknown query parameters (default: `false`). */
  strictQueryParameters?: boolean;
  /**
   * How to handle a spec whose `openapi` field is missing, malformed,
   * or not one of the supported versions (3.0, 3.1, 3.2).
   *
   * - `"fallback31"` (default) — silently use the 3.1 dialect.
   * - `"warn"` — emit a warning via {@link ValidatorOptions.warn} (defaults
   *   to `process.stderr.write`) and use the 3.1 dialect.
   * - `"throw"` — throw an `Error`.
   *
   * Regardless of the choice, `OavValidator.detectedVersion` is set to
   * `undefined` so callers can introspect after the fact.
   */
  onUnknownVersion?: "fallback31" | "warn" | "throw";
  /**
   * Sink for the warning emitted by `onUnknownVersion: "warn"`. Defaults
   * to `(m) => process.stderr.write(m)`. Inject an alternative when
   * embedding the validator in workers / edge runtimes / test harnesses
   * where `process.stderr` isn't the right destination.
   */
  warn?: (message: string) => void;
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
        const warn = options.warn ?? ((m: string) => void process.stderr.write(m));
        warn(
          "createValidator: spec has a missing or unsupported `openapi` field; falling back to the 3.1 dialect\n",
        );
      }
      return openapi31Dialect;
    }
    return dialectFor(detectedVersion);
  })();

  const graph = resolve(spec as unknown as SchemaOrBoolean);
  const refResolver: RefResolver = createRefResolver(graph);

  const stats: ValidatorStats = { responseBodiesCompiled: 0 };

  const compiledCache = new Map<SchemaOrBoolean, CompiledSchema>();
  const compile = (
    schema: SchemaOrBoolean,
    resolver: RefResolver = refResolver,
  ): CompiledSchema => {
    const cached = compiledCache.get(schema);
    if (cached !== undefined) return cached;
    const c = compileSchema(schema, {
      dialect,
      formats,
      refResolver: resolver,
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
  // The direction resolvers project the same transform across every
  // `$ref` target so inherited `properties` / `required` from composed
  // schemas (`allOf: [{ $ref: ... }]`) are transformed too.
  const directionTransformCache = {
    request: new Map<SchemaOrBoolean, SchemaOrBoolean>(),
    response: new Map<SchemaOrBoolean, SchemaOrBoolean>(),
  };
  const directionResolvers = {
    request: createDirectionResolver(refResolver, "request", directionTransformCache.request),
    response: createDirectionResolver(refResolver, "response", directionTransformCache.response),
  };
  const compileForDirection = (schema: SchemaOrBoolean, direction: BodyDirection): CompiledSchema =>
    compile(
      transformBodySchemaForDirection(
        schema,
        direction,
        refResolver,
        directionTransformCache[direction],
      ),
      directionResolvers[direction],
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
    if (direction === "response") stats.responseBodiesCompiled += 1;
    return c;
  };

  const resolveRef = <T>(value: T | ReferenceObject | undefined): T | undefined =>
    resolveOperationRef<T>(spec, value);

  const operationCache = new WeakMap<OperationObject, OperationCache>();

  const cacheFor = (pathMatch: RouteMatch): OperationCache => {
    const existing = operationCache.get(pathMatch.operation);
    if (existing !== undefined) return existing;
    const cache = buildOperationCache(pathMatch, { resolveRef, compile, compileForDirection });
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
    if (match.kind === "method-not-allowed") {
      return createLeafError(
        "method",
        [],
        `method ${req.method.toUpperCase()} not allowed on ${match.pathPattern}; allowed: ${match.allowed.join(", ")}`,
        { method: req.method, pathPattern: match.pathPattern, allowed: match.allowed },
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
              in: "query",
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
    if (match.kind === "method-not-allowed") {
      return createLeafError(
        "method",
        [],
        `method ${req.method.toUpperCase()} not allowed on ${match.pathPattern}; allowed: ${match.allowed.join(", ")}`,
        { method: req.method, pathPattern: match.pathPattern, allowed: match.allowed },
      );
    }
    const cache = cacheFor(match);
    const children: ValidationError[] = [];

    const statusKey = matchResponseKey(res.status, Object.fromEntries(cache.responses));
    if (statusKey === undefined) {
      children.push(
        createLeafError("status", [], `no response defined for status ${res.status}`, {
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
                  ["header", name],
                  `missing required header "${name}"`,
                  {
                    name,
                    in: "header",
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
            const r = validator.validate(value, ["header", name]);
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
                ["body"],
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
              const r = validator.validate(res.body, ["body"]);
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

  const validateFetchRequest = async <T>(
    request: Request,
    options?: FetchRequestOptions,
  ): Promise<{ ok: true; body: T } | { ok: false; error: ValidationError }> => {
    const { httpRequest, body } = await httpRequestFromFetch(request, options);
    const error = validateRequest(httpRequest);
    if (error === null) return { ok: true, body: body as T };
    return { ok: false, error };
  };

  const validateFetchResponse = async <T>(
    request: Request,
    response: Response,
  ): Promise<{ ok: true; body: T } | { ok: false; error: ValidationError }> => {
    // Build an HttpRequest from the fetch Request without reading its
    // body — we only need method + path to match the operation.
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const httpRequest: HttpRequest = { method, path: url.pathname };
    const { httpResponse, body } = await httpResponseFromFetch(response);
    const error = validateResponse(httpRequest, httpResponse);
    if (error === null) return { ok: true, body: body as T };
    return { ok: false, error };
  };

  return {
    validateRequest,
    validateResponse,
    validateFetchRequest,
    validateFetchResponse,
    detectedVersion,
    stats,
  };
}
