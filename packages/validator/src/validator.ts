import {
  classifyUnknownVersion,
  createBranchError,
  createLeafError,
  detectOpenAPIVersion,
  type HttpRequest,
  type HttpResponse,
  type OpenAPIDocument,
  type OpenAPIVersion,
  type OperationObject,
  type PathItem,
  type ReferenceObject,
  type SchemaOrBoolean,
  type ValidationError,
} from "@oav/core";
import { builtInFormats } from "@oav/formats";
import { createRouter, type RouteMatch, type Router } from "@oav/router";
import { lintResolvedSpec, type SpecHygieneIssue } from "@oav/spec";
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
  type StrictIssue,
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
import { checkSecurity, compileOperationSecurity } from "./security.js";
import { checkBodyContentType, validateBody, validateParameter } from "./validate-step.js";

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
export interface Validator {
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
   * {@link validateFetchRequest} for the response side; useful when
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
   * Look up the effective operation declaration for a method + path.
   * Returns the resolved (`$ref`s followed) and overlay-applied
   * {@link OperationObject}, the matched path pattern, and the
   * enclosing {@link PathItem}. Returns `null` when no operation
   * matches (either the path doesn't match any template or the
   * method isn't declared on it).
   *
   * Startup-time introspection, not a validation step: the spec is
   * frozen at `createValidator` time, so this is safe to call once
   * during application init and cache the result. Callers typically
   * use it to derive middleware configuration (multer limits,
   * accepted content types, required headers) from the same source
   * of truth the validator uses.
   *
   * Uses the same per-operation cache the validation path uses;
   * repeated calls are O(route-match) with no extra compilation.
   *
   * @example
   * ```ts
   * const info = validator.getOperation({ method: "POST", path: "/uploads" });
   * const mediaTypes = Object.keys(info?.operation.requestBody?.content ?? {});
   * ```
   */
  getOperation(req: { method: string; path: string }): {
    pathPattern: string;
    pathItem: PathItem;
    operation: OperationObject;
  } | null;
  /**
   * The OpenAPI version detected from the spec's `openapi` field, or
   * `undefined` when the field was missing/malformed and the validator
   * fell back to its default dialect (see
   * {@link ValidatorOptions.onUnknownVersion}).
   */
  readonly detectedVersion: OpenAPIVersion | undefined;
  /**
   * Warnings collected during `createValidator`. Populated when
   * `onUnknownVersion: "warn"` fires, or when the `dialect` escape
   * hatch suppresses a category error that would otherwise throw
   * (missing `openapi` field, wrong major). Empty when neither applies.
   *
   * The library never writes to `process.stderr` or `console`; this
   * array is the library's only record of such events. Callers that
   * want live output pass {@link ValidatorOptions.warn}; the CLI
   * wrapper does this.
   *
   * Frozen after `createValidator` returns; no post-construction
   * writes happen.
   */
  readonly warnings: readonly string[];
  /**
   * Spec-hygiene findings from {@link lintResolvedSpec}, populated when
   * {@link ValidatorOptions.lint} is `true`. Empty otherwise. Frozen
   * after `createValidator` returns.
   *
   * Different from {@link ValidatorStats.strictIssues}, which lints
   * compiled schemas; this one lints the OpenAPI document itself
   * (unused components, dead path parameters, unreachable `$defs`).
   */
  readonly specHygieneIssues: readonly SpecHygieneIssue[];
  /**
   * Runtime observability for compile-time-specialisation optimisations.
   * The counters live on the validator, not inside a ValidationError
   * tree, so tests can assert on the optimisation directly rather than
   * through indirect signals (throwing test schemas, source grepping).
   */
  readonly stats: ValidatorStats;
}

/**
 * Live counters attached to an {@link Validator}.
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
  /**
   * Live array of strict-mode issues surfaced by
   * {@link ValidatorOptions.strict}. Grows as schemas compile (request
   * / path / header / query schemas at construction; response-body
   * schemas lazily on first use). An empty array when `strict: "off"`
   * or when the linter found nothing to flag.
   *
   * Schema paths are the full path inside each compiled schema, not
   * HTTP-frame-prefixed; the linter runs over raw JSON Schema, not
   * OpenAPI.
   */
  strictIssues: readonly StrictIssue[];
}

/**
 * The full set of {@link createValidator} tunables. Every knob you
 * might reach for lives on this type; the per-field TSDoc below is
 * the canonical contract for each one. The integration guide carries
 * worked examples; this type carries the API.
 *
 * - **Dialect override**: {@link ValidatorOptions.dialect}.
 * - **Schema extension**: {@link ValidatorOptions.formats},
 *   {@link ValidatorOptions.keywords}.
 * - **Error budget**: {@link ValidatorOptions.maxErrors}.
 * - **Strict-mode linting**: {@link ValidatorOptions.strict}.
 * - **Security gating**: {@link ValidatorOptions.validateSecurity}.
 * - **Path filtering**: {@link ValidatorOptions.ignoreUndocumented},
 *   {@link ValidatorOptions.ignorePaths}.
 * - **Query strictness**: {@link ValidatorOptions.strictQueryParameters}.
 * - **Version mismatch**: {@link ValidatorOptions.onUnknownVersion}.
 * - **Warn sink**: {@link ValidatorOptions.warn}.
 *
 * @remarks
 * Ordering convention (shared with
 * {@link @aahoughton/oav/schema!CompileOptions}):
 *
 *   1. Compile essentials: `dialect`.
 *   2. Shared extension points: `formats`, `keywords`.
 *   3. Error-collection policy: `maxErrors`.
 *   4. Surface-specific extras last: here, `strictQueryParameters`,
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
   *
   * Setting `dialect` is also the universal escape hatch for the
   * category-error checks that normally throw at construction: a
   * missing/non-string `openapi` field or a wrong major version
   * would reject the spec by default, but an explicit `dialect`
   * signals "I know what I'm doing" and compilation proceeds. A
   * single warning is emitted via {@link ValidatorOptions.warn}
   * when the override suppresses a would-be category error, so
   * accidental misuse is still visible.
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
   *
   * Must be a positive integer (>= 1). `createValidator` throws on
   * non-integer or zero/negative values; the compiler surfaces the
   * error eagerly at construction time.
   */
  maxErrors?: number;
  /**
   * Compile-time schema linting applied to every schema the validator
   * compiles (request parameters / body; response headers; response
   * bodies lazily). Issues surface via
   * {@link ValidatorStats.strictIssues}; no throws.
   *
   * - `"off"`: silence on everything.
   * - `"warn-partial"` (default): warn on keywords flagged as
   *   partially-implemented (currently `$dynamicRef`).
   * - `"strict"`: warn on partial features AND unknown keys.
   */
  strict?: "off" | "warn-partial" | "strict";

  // --- 4. HTTP-validator-specific extras ---

  /**
   * Reject requests that don't satisfy the declared
   * {@link OperationObject.security} (or document-level
   * {@link OpenAPIDocument.security} when the operation doesn't override).
   * **Shape-only**: the check confirms the request carries the declared
   * credential (e.g. a `Bearer` token in `Authorization`, the declared
   * apiKey header); it does not verify the credential itself. Credential
   * verification stays with the app's auth middleware.
   *
   * Supported schemes: `http` with `scheme: "bearer"` or `"basic"`, and
   * `apiKey` in header / query / cookie. `oauth2`, `openIdConnect`, and
   * `mutualTLS` are accepted in the spec but not shape-checked at the
   * validator layer.
   *
   * Defaults to `false`. Real apps gate security upstream of validation:
   * by the time the validator runs, the auth middleware has already
   * verified (or rejected) the credential. Opt in with `true` when
   * there's no auth middleware (early dev / prototyping) or when the
   * auth layer only decorates `req` without rejecting unauthenticated
   * traffic. Opting in is shape-only and is **not** a substitute for
   * actual credential verification.
   */
  validateSecurity?: boolean;
  /** When `true`, reject unknown query parameters (default: `false`). */
  strictQueryParameters?: boolean;
  /**
   * When `true`, an unmatched path no longer produces a `route` error;
   * `validateRequest` / `validateResponse` return `null`. Mirrors
   * `express-openapi-validator`'s `ignoreUndocumented`. Does not affect
   * the `method` code: a path that matched but whose verb wasn't
   * declared still surfaces (that's a 405, not an "undocumented route").
   */
  ignoreUndocumented?: boolean;
  /**
   * Predicate for finer control than {@link ValidatorOptions.ignoreUndocumented}.
   * Runs before route matching; when it returns `true` for the request's
   * `path`, the validator short-circuits and returns `null`. Useful for
   * per-prefix allowlists ("skip anything under `/internal/`"),
   * regex-driven exclusions, or keeping parts of the surface out of
   * spec validation for staged rollout.
   *
   * When both `ignorePaths` and `ignoreUndocumented` are set,
   * `ignorePaths` runs first. If the predicate does not skip,
   * `ignoreUndocumented` still applies to a subsequent route miss.
   */
  ignorePaths?: (path: string) => boolean;
  /**
   * How to handle a spec with an unknown **minor** version inside the
   * OpenAPI 3.x line; e.g. `openapi: "3.7.0"` if a future minor ships
   * before oav is updated. Pure forward-compat control; does not govern
   * category errors (missing `openapi` field, wrong major), which
   * always throw unless `dialect` is set.
   *
   * - `"fallback31"` (default): accept silently; use the 3.1 dialect.
   * - `"warn"`: add an entry to {@link Validator.warnings} (and
   *   call {@link ValidatorOptions.warn} if provided) and use the 3.1
   *   dialect.
   * - `"throw"`: throw an `Error`.
   *
   * Regardless of the choice, `Validator.detectedVersion` is set to
   * `undefined` so callers can introspect after the fact.
   */
  onUnknownVersion?: "fallback31" | "warn" | "throw";
  /**
   * Optional live-output sink for warnings, called synchronously
   * during {@link createValidator} whenever a warning is emitted
   * (currently: `onUnknownVersion: "warn"` path, and the single
   * category-error-overridden-by-`dialect` case). Every warning is
   * _also_ accumulated into {@link Validator.warnings} regardless
   * of whether this callback is set.
   *
   * Default: undefined (no live sink). The library never writes to
   * `process.stderr` or `console` on its own; pass a callback if you
   * want live output. The CLI wrapper supplies one that prints to
   * stderr.
   */
  warn?: (message: string) => void;
  /**
   * Run spec-hygiene lint passes against the document at construction.
   * Findings land in {@link Validator.specHygieneIssues}; nothing is
   * thrown. Defaults to `false`.
   *
   * The same engine runs from
   * {@link @aahoughton/oav/spec!resolveSpec} and
   * {@link @aahoughton/oav/spec!loadSpec}; pick whichever layer is
   * natural for your flow. Running it in both places lints twice for
   * no benefit.
   */
  lint?: boolean;
}

/**
 * Build a {@link Validator} from a resolved OpenAPI 3.1 document.
 *
 * @param spec - The fully-resolved OpenAPI document (no external `$ref`s).
 * @param options - Tunables for the validator. See {@link ValidatorOptions}
 *   for the full set: security gating, path filtering, dialect override,
 *   error budget, custom formats and keywords, strict-mode linting,
 *   version-mismatch handling, and a warn-output sink.
 * @returns A validator that can check individual requests and responses.
 *
 * @example
 * ```ts
 * const v = createValidator(resolvedSpec);
 * const err = v.validateRequest({ method: "POST", path: "/pets", body: {...} });
 * ```
 *
 * @see {@link ValidatorOptions}
 * @public
 */
export function createValidator(spec: OpenAPIDocument, options: ValidatorOptions = {}): Validator {
  if (
    options.maxErrors !== undefined &&
    Number.isFinite(options.maxErrors) &&
    (!Number.isInteger(options.maxErrors) || options.maxErrors < 1)
  ) {
    // `Infinity` is degenerate (equivalent to omitting) but harmless;
    // existing callers may pass it explicitly. Reject the values that
    // would silently break validation: 0, negatives, non-integers.
    throw new Error(
      `createValidator: \`maxErrors\` must be a positive integer (got ${String(options.maxErrors)}). ` +
        "Use `maxErrors: 1` for fast-fail, or omit the option for uncapped error collection.",
    );
  }
  const paths = spec.paths ?? {};
  const router: Router = createRouter(paths);
  const formats = { ...builtInFormats, ...options.formats };

  // Warnings are accumulated passively (no I/O from the library); a
  // caller-supplied `options.warn` additionally gets them live. The
  // CLI wrapper passes a stderr-writing callback; the core library
  // never does.
  const warnings: string[] = [];
  const emitWarn = (message: string): void => {
    warnings.push(message);
    options.warn?.(message);
  };

  // Version detection is pure compile-time: we bake the right
  // dialect into the compiled validator and never branch on version
  // per request.
  //
  // Three categories of input:
  //   (1) valid 3.x spec (3.0 / 3.1 / 3.2): pick dialect, compile
  //   (2) missing openapi field / wrong major: category error, throw
  //       (unless `dialect` is set, which is the universal override)
  //   (3) valid 3.x major but unknown minor (e.g. "3.7.0"): forward
  //       compat, governed by `onUnknownVersion`
  const detectedVersion = detectOpenAPIVersion(spec);
  const dialect: Dialect = (() => {
    if (detectedVersion !== undefined) return dialectFor(detectedVersion);

    // Classify the reason detection failed so we can distinguish
    // category errors from unknown-minor forward-compat.
    const rawOpenapi = (spec as { openapi?: unknown }).openapi;
    const reason = classifyUnknownVersion(rawOpenapi);

    if (reason.kind === "ok-unknown-minor") {
      if (options.dialect !== undefined) return options.dialect;
      const policy = options.onUnknownVersion ?? "fallback31";
      if (policy === "throw") {
        throw new Error(
          `createValidator: openapi: "${reason.raw}" is an unknown 3.x minor version; ` +
            "set onUnknownVersion to 'warn' or 'fallback31' to accept it, or pass `dialect` to force a specific compiler",
        );
      }
      if (policy === "warn") {
        emitWarn(
          `createValidator: openapi: "${reason.raw}" is an unknown 3.x minor version; falling back to the 3.1 dialect`,
        );
      }
      return openapi31Dialect;
    }

    // Category error: missing field, wrong major, or non-string.
    // `dialect` is the universal override; emit a warning so the
    // override is still visible but don't block compilation.
    if (options.dialect !== undefined) {
      emitWarn(`createValidator: ${reason.message}; compiling anyway because \`dialect\` was set`);
      return options.dialect;
    }
    throw new Error(`createValidator: ${reason.message}`);
  })();

  const graph = resolve(spec as unknown as SchemaOrBoolean);
  const refResolver: RefResolver = createRefResolver(graph);

  // Live array. Compile closure appends on each miss; consumers read
  // `validator.stats.strictIssues` at any point to see what's been
  // flagged so far.
  const strictIssues: StrictIssue[] = [];
  const stats: ValidatorStats = {
    responseBodiesCompiled: 0,
    strictIssues,
  };

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
      strict: options.strict,
    });
    compiledCache.set(schema, c);
    for (const issue of c.stats.strictIssues) strictIssues.push(issue);
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

  const validateSecurity = options.validateSecurity === true;

  const cacheFor = (pathMatch: RouteMatch): OperationCache => {
    const existing = operationCache.get(pathMatch.operation);
    if (existing !== undefined) return existing;
    const cache = buildOperationCache(pathMatch, { resolveRef, compile, compileForDirection });
    if (validateSecurity) {
      cache.security = compileOperationSecurity(pathMatch.operation, spec, resolveRef);
    }
    operationCache.set(pathMatch.operation, cache);
    return cache;
  };

  const validateRequest = (req: HttpRequest): ValidationError | null => {
    if (options.ignorePaths?.(req.path) === true) return null;
    const match = router.match(req.method, req.path);
    if (match === undefined) {
      if (options.ignoreUndocumented === true) return null;
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

    // Security check first and short-circuit: an auth failure makes
    // every parameter / body diagnostic noise, and the client can't act
    // on the latter without fixing the former.
    if (cache.security !== undefined) {
      const securityErr = checkSecurity(cache.security, req);
      if (securityErr !== null) {
        return createBranchError(
          "request",
          [],
          `${req.method.toUpperCase()} ${match.pathPattern}: request validation failed`,
          [securityErr],
          { method: req.method, pathPattern: match.pathPattern },
        );
      }
    }

    // Content-type gate: if the request carries a body whose
    // Content-Type doesn't match any declared media type, short-circuit
    // with a single leaf. Parameter / body schema diagnostics against a
    // request the server can't parse in the first place are noise.
    const ctErr = checkBodyContentType(req, cache);
    if (ctErr !== null) {
      return createBranchError(
        "request",
        [],
        `${req.method.toUpperCase()} ${match.pathPattern}: request validation failed`,
        [ctErr],
        { method: req.method, pathPattern: match.pathPattern },
      );
    }

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
    if (options.ignorePaths?.(req.path) === true) return null;
    const match = router.match(req.method, req.path);
    if (match === undefined) {
      if (options.ignoreUndocumented === true) return null;
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
    // body; we only need method + path to match the operation.
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const httpRequest: HttpRequest = { method, path: url.pathname };
    const { httpResponse, body } = await httpResponseFromFetch(response);
    const error = validateResponse(httpRequest, httpResponse);
    if (error === null) return { ok: true, body: body as T };
    return { ok: false, error };
  };

  const getOperation = (req: {
    method: string;
    path: string;
  }): { pathPattern: string; pathItem: PathItem; operation: OperationObject } | null => {
    const match = router.match(req.method, req.path);
    if (match === undefined || match.kind === "method-not-allowed") return null;
    // Warm the per-operation cache so `getOperation` and subsequent
    // validation share a single compiled plan. Doesn't force response
    // compilation (still lazy on first `validateResponse`).
    cacheFor(match);
    return {
      pathPattern: match.pathPattern,
      pathItem: match.pathItem,
      operation: match.operation,
    };
  };

  const specHygieneIssues: readonly SpecHygieneIssue[] = options.lint
    ? Object.freeze(lintResolvedSpec(spec))
    : [];

  return {
    validateRequest,
    validateResponse,
    validateFetchRequest,
    validateFetchResponse,
    getOperation,
    detectedVersion,
    warnings,
    specHygieneIssues,
    stats,
  };
}
