/**
 * Shared structural types for OpenAPI 3.1 documents, JSON Schema objects, and
 * HTTP request/response envelopes. These types are intentionally permissive —
 * they describe the shape {@link @oav/spec} and {@link @oav/validator}
 * produce/consume, not a fully-checked schema.
 */

/**
 * A JSON value, as accepted/emitted by JSON.parse / JSON.stringify.
 *
 * @public
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A JSON Schema reference object (`{ "$ref": "..." }`).
 *
 * @public
 */
export interface ReferenceObject {
  $ref: string;
  summary?: string;
  description?: string;
}

/**
 * A JSON Schema 2020-12 object. This is a loose structural type: fields are
 * all optional and the compiler validates them.
 *
 * @remarks
 * JSON Schema 2020-12 permits a boolean schema (`true` / `false`) in place of
 * a schema object. Functions that accept schemas use `SchemaOrBoolean`.
 *
 * @public
 */
export interface SchemaObject {
  $id?: string;
  $schema?: string;
  $ref?: string;
  $anchor?: string;
  $dynamicRef?: string;
  $dynamicAnchor?: string;
  $defs?: Record<string, SchemaOrBoolean>;
  $comment?: string;

  type?: string | string[];
  enum?: JsonValue[];
  const?: JsonValue;

  multipleOf?: number;
  maximum?: number;
  /**
   * In JSON Schema 2020-12 (OpenAPI 3.1/3.2): a number, and stands alone.
   * In OpenAPI 3.0: a boolean that modifies the sibling {@link SchemaObject.maximum}.
   * The dialect the compiler runs under decides which semantics apply.
   */
  exclusiveMaximum?: number | boolean;
  minimum?: number;
  /**
   * In JSON Schema 2020-12 (OpenAPI 3.1/3.2): a number, and stands alone.
   * In OpenAPI 3.0: a boolean that modifies the sibling {@link SchemaObject.minimum}.
   */
  exclusiveMinimum?: number | boolean;
  /**
   * OpenAPI 3.0 only. Combined with `type`, means "type OR null".
   * In 3.1+ use `type: ["…", "null"]` instead. Ignored outside the
   * 3.0 dialect.
   */
  nullable?: boolean;

  maxLength?: number;
  minLength?: number;
  pattern?: string;
  format?: string;

  items?: SchemaOrBoolean;
  prefixItems?: SchemaOrBoolean[];
  contains?: SchemaOrBoolean;
  maxContains?: number;
  minContains?: number;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  unevaluatedItems?: SchemaOrBoolean;

  properties?: Record<string, SchemaOrBoolean>;
  patternProperties?: Record<string, SchemaOrBoolean>;
  additionalProperties?: SchemaOrBoolean;
  propertyNames?: SchemaOrBoolean;
  required?: string[];
  maxProperties?: number;
  minProperties?: number;
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, SchemaOrBoolean>;
  unevaluatedProperties?: SchemaOrBoolean;

  allOf?: SchemaOrBoolean[];
  anyOf?: SchemaOrBoolean[];
  oneOf?: SchemaOrBoolean[];
  not?: SchemaOrBoolean;
  if?: SchemaOrBoolean;
  then?: SchemaOrBoolean;
  else?: SchemaOrBoolean;

  title?: string;
  description?: string;
  default?: JsonValue;
  examples?: JsonValue[];
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;

  discriminator?: DiscriminatorObject;

  [extension: `x-${string}`]: JsonValue | undefined;
}

/**
 * A schema value: either a schema object or a boolean (`true` accepts all,
 * `false` rejects all).
 *
 * @public
 */
export type SchemaOrBoolean = SchemaObject | boolean;

/**
 * OpenAPI 3.1 discriminator object.
 *
 * @public
 */
export interface DiscriminatorObject {
  propertyName: string;
  mapping?: Record<string, string>;
}

/**
 * Top-level OpenAPI document shape. Loose enough to accept 3.0, 3.1,
 * and 3.2: fields only present on newer versions (`webhooks`,
 * `jsonSchemaDialect`) are optional; the `openapi` string discriminates
 * at validator-construction time via
 * {@link detectOpenAPIVersion | detectOpenAPIVersion}.
 *
 * @public
 */
export interface OpenAPIDocument {
  openapi: string;
  info: InfoObject;
  servers?: ServerObject[];
  paths?: Record<string, PathItem>;
  components?: ComponentsObject;
  tags?: TagObject[];
  /** 3.1+: declared webhooks. Absent in 3.0. */
  webhooks?: Record<string, PathItem | ReferenceObject>;
  /** 3.1+: overrides the default schema dialect URI. Absent in 3.0. */
  jsonSchemaDialect?: string;
  [extension: `x-${string}`]: JsonValue | undefined;
}

/**
 * OpenAPI `info` object (metadata).
 *
 * @public
 */
export interface InfoObject {
  title: string;
  version: string;
  description?: string;
  summary?: string;
}

/**
 * OpenAPI `server` entry.
 *
 * @public
 */
export interface ServerObject {
  url: string;
  description?: string;
}

/**
 * OpenAPI `tag` entry.
 *
 * @public
 */
export interface TagObject {
  name: string;
  description?: string;
}

/**
 * OpenAPI reusable `components` container.
 *
 * @public
 */
export interface ComponentsObject {
  schemas?: Record<string, SchemaOrBoolean>;
  parameters?: Record<string, ParameterObject>;
  requestBodies?: Record<string, RequestBodyObject>;
  responses?: Record<string, ResponseObject>;
  headers?: Record<string, HeaderObject>;
}

/**
 * OpenAPI `pathItem`: the collection of operations available at a path.
 * `query` is new in 3.2 (the HTTP QUERY method for read-side requests
 * with a body). Older specs just don't set it.
 *
 * @public
 */
export interface PathItem {
  summary?: string;
  description?: string;
  get?: OperationObject;
  put?: OperationObject;
  post?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  patch?: OperationObject;
  trace?: OperationObject;
  /** 3.2+: HTTP QUERY method. */
  query?: OperationObject;
  parameters?: (ParameterObject | ReferenceObject)[];
}

/**
 * The HTTP method names that can appear on a {@link PathItem}. `query`
 * is added in OpenAPI 3.2; earlier documents may not use it. Routing
 * is case-insensitive — validators lower-case the request's method
 * before lookup.
 *
 * @public
 */
export type HttpMethod =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace"
  | "query";

/**
 * OpenAPI `operationObject` (a single method on a path).
 *
 * @public
 */
export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: (ParameterObject | ReferenceObject)[];
  requestBody?: RequestBodyObject | ReferenceObject;
  responses?: Record<string, ResponseObject | ReferenceObject>;
  deprecated?: boolean;
}

/**
 * OpenAPI parameter location.
 *
 * @public
 */
export type ParameterLocation = "path" | "query" | "header" | "cookie";

/**
 * OpenAPI parameter serialization style.
 *
 * @public
 */
export type ParameterStyle =
  | "matrix"
  | "label"
  | "simple"
  | "form"
  | "spaceDelimited"
  | "pipeDelimited"
  | "deepObject";

/**
 * OpenAPI `parameterObject`.
 *
 * @public
 */
export interface ParameterObject {
  name: string;
  in: ParameterLocation;
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  style?: ParameterStyle;
  explode?: boolean;
  allowReserved?: boolean;
  schema?: SchemaOrBoolean;
  content?: Record<string, MediaTypeObject>;
  example?: JsonValue;
  examples?: Record<string, JsonValue>;
}

/**
 * OpenAPI `requestBodyObject`.
 *
 * @public
 */
export interface RequestBodyObject {
  description?: string;
  content: Record<string, MediaTypeObject>;
  required?: boolean;
}

/**
 * OpenAPI `responseObject`.
 *
 * @public
 */
export interface ResponseObject {
  description?: string;
  headers?: Record<string, HeaderObject | ReferenceObject>;
  content?: Record<string, MediaTypeObject>;
}

/**
 * OpenAPI `mediaTypeObject`.
 *
 * @public
 */
export interface MediaTypeObject {
  schema?: SchemaOrBoolean;
  example?: JsonValue;
  examples?: Record<string, JsonValue>;
}

/**
 * OpenAPI `headerObject` (like a parameter, but with `in` fixed to `header`).
 *
 * @public
 */
export interface HeaderObject {
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  style?: ParameterStyle;
  explode?: boolean;
  schema?: SchemaOrBoolean;
  content?: Record<string, MediaTypeObject>;
}

/**
 * An abstract HTTP request used by the validator. Values are pre-parsed
 * where convenient (e.g. `query` is a record, `headers` is a record); raw
 * strings are still accepted for parameter deserialization.
 *
 * @public
 */
export interface HttpRequest {
  method: string;
  path: string;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string | string[]>;
  cookies?: Record<string, string>;
  contentType?: string;
  body?: JsonValue | undefined;
  rawBody?: string | undefined;
}

/**
 * An abstract HTTP response used by the validator.
 *
 * @public
 */
export interface HttpResponse {
  status: number;
  headers?: Record<string, string | string[]>;
  contentType?: string;
  body?: JsonValue | undefined;
  rawBody?: string | undefined;
}
