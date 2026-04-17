import {
  createBranchError,
  createLeafError,
  type HttpRequest,
  type HttpResponse,
  type OpenAPIDocument,
  type OperationObject,
  type ParameterObject,
  type SchemaOrBoolean,
  type ValidationError,
} from "@oav/core";
import { builtInFormats } from "@oav/formats";
import { createRouter, type RouteMatch, type Router } from "@oav/router";
import {
  applicatorVocabulary,
  compileSchema,
  coreVocabulary,
  createRefResolver,
  formatAssertionVocabulary,
  formatVocabulary,
  resolve,
  unevaluatedVocabulary,
  validationVocabulary,
  type CompiledSchema,
  type RefResolver,
} from "@oav/schema";

// OpenAPI semantics: `format` is assertive. Place the assertion vocabulary
// ahead of the annotation vocabulary so the assertive keyword wins.
const openapiVocabularies = [
  coreVocabulary,
  validationVocabulary,
  applicatorVocabulary,
  unevaluatedVocabulary,
  formatAssertionVocabulary,
  formatVocabulary,
];
import { deserialize, matchMediaType, matchResponseKey } from "./deserialize.js";

function prefixPath(err: ValidationError, prefix: (string | number)[]): ValidationError {
  return {
    ...err,
    path: [...prefix, ...err.path],
    children: err.children.map((c) => prefixPath(c, prefix)),
  };
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
}

interface OperationCache {
  pathParamValidators: Map<string, CompiledSchema>;
  queryParamValidators: Map<string, CompiledSchema>;
  headerParamValidators: Map<string, CompiledSchema>;
  cookieParamValidators: Map<string, CompiledSchema>;
  parameters: ParameterObject[];
  bodyValidators: Map<string, CompiledSchema>;
  responseValidators: Map<string, ResponseCompiled>;
}

interface ResponseCompiled {
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

  const graph = resolve(spec as unknown as SchemaOrBoolean);
  const refResolver: RefResolver = createRefResolver(graph);

  const compiledCache = new Map<SchemaOrBoolean, CompiledSchema>();
  const compile = (schema: SchemaOrBoolean): CompiledSchema => {
    const cached = compiledCache.get(schema);
    if (cached !== undefined) return cached;
    const c = compileSchema(schema, {
      vocabularies: openapiVocabularies,
      formats,
      refResolver,
    });
    compiledCache.set(schema, c);
    return c;
  };

  const operationCache = new WeakMap<OperationObject, OperationCache>();

  const cacheFor = (pathMatch: RouteMatch): OperationCache => {
    const existing = operationCache.get(pathMatch.operation);
    if (existing !== undefined) return existing;
    const parameters: ParameterObject[] = [
      ...(pathMatch.pathItem.parameters ?? []),
      ...(pathMatch.operation.parameters ?? []),
    ];

    const pathParamValidators = new Map<string, CompiledSchema>();
    const queryParamValidators = new Map<string, CompiledSchema>();
    const headerParamValidators = new Map<string, CompiledSchema>();
    const cookieParamValidators = new Map<string, CompiledSchema>();

    for (const p of parameters) {
      const schema = p.schema;
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
    const body = pathMatch.operation.requestBody;
    if (body) {
      for (const [mt, mto] of Object.entries(body.content)) {
        if (mto.schema) bodyValidators.set(mt, compile(mto.schema));
      }
    }

    const responseValidators = new Map<string, ResponseCompiled>();
    const responses = pathMatch.operation.responses ?? {};
    for (const [status, response] of Object.entries(responses)) {
      const bodyVs = new Map<string, CompiledSchema>();
      const headerVs = new Map<string, CompiledSchema>();
      for (const [mt, mto] of Object.entries(response.content ?? {})) {
        if (mto.schema) bodyVs.set(mt, compile(mto.schema));
      }
      for (const [name, hdr] of Object.entries(response.headers ?? {})) {
        if (hdr.schema) headerVs.set(name.toLowerCase(), compile(hdr.schema));
      }
      responseValidators.set(status, { bodyValidators: bodyVs, headerValidators: headerVs });
    }

    const cache: OperationCache = {
      parameters,
      pathParamValidators,
      queryParamValidators,
      headerParamValidators,
      cookieParamValidators,
      bodyValidators,
      responseValidators,
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

    if (cache.bodyValidators.size > 0) {
      const err = validateBody(req, cache, match.operation);
      if (err !== null) children.push(err);
    } else if (req.body !== undefined && match.operation.requestBody === undefined) {
      // body present but operation accepts none; not strictly an error by default
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

    const statusKey = matchResponseKey(res.status, Object.fromEntries(cache.responseValidators));
    if (statusKey === undefined) {
      children.push(
        createLeafError("status", ["response"], `no response defined for status ${res.status}`, {
          status: res.status,
        }),
      );
    } else {
      const responseCompiled = cache.responseValidators.get(statusKey);
      if (responseCompiled !== undefined) {
        const responseObj = (match.operation.responses ?? {})[statusKey];
        if (res.headers && responseObj?.headers) {
          for (const [name, hdr] of Object.entries(responseObj.headers)) {
            const lowered = name.toLowerCase();
            const validator = responseCompiled.headerValidators.get(lowered);
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
            if (validator === undefined || raw === undefined) continue;
            const value = deserialize(raw, {
              name,
              in: "header",
              schema: hdr.schema,
              style: hdr.style,
              explode: hdr.explode,
            });
            const r = validator.validate(value);
            if (!r.valid && r.error !== undefined) {
              children.push(prefixPath(r.error, ["response", "headers", name]));
            }
          }
        }

        if (responseCompiled.bodyValidators.size > 0 && res.body !== undefined) {
          const mt = matchMediaType(res.contentType, responseCompiled.bodyValidators.keys());
          if (mt === undefined) {
            children.push(
              createLeafError(
                "content-type",
                ["response", "body"],
                `response Content-Type "${res.contentType ?? "<missing>"}" is not declared for status ${statusKey}`,
                {
                  contentType: res.contentType,
                  declared: [...responseCompiled.bodyValidators.keys()],
                },
              ),
            );
          } else {
            const validator = responseCompiled.bodyValidators.get(mt);
            if (validator !== undefined) {
              const r = validator.validate(res.body);
              if (!r.valid && r.error !== undefined) {
                children.push(prefixPath(r.error, ["response", "body"]));
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

  return { validateRequest, validateResponse };
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

  if (raw === undefined || raw === "") {
    if (p.required) {
      return createLeafError(code, pathPrefix, `missing required ${p.in} parameter "${p.name}"`, {
        name: p.name,
        in: p.in,
      });
    }
    return null;
  }
  if (validator === undefined) return null;

  const value = deserialize(raw, p);
  const r = validator.validate(value);
  if (r.valid || r.error === undefined) return null;
  return prefixPath(r.error, pathPrefix);
}

function validateBody(
  req: HttpRequest,
  cache: OperationCache,
  operation: OperationObject,
): ValidationError | null {
  const body = operation.requestBody;
  if (body === undefined) return null;
  const hasBody = req.body !== undefined && req.body !== null;
  if (!hasBody) {
    if (body.required) {
      return createLeafError("body", ["body"], "missing required request body", {});
    }
    return null;
  }
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
  const r = validator.validate(req.body);
  if (r.valid || r.error === undefined) return null;
  return prefixPath(r.error, ["body"]);
}
