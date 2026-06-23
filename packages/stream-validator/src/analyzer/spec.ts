/**
 * Per-operation streamability rollup over a resolved OpenAPI document. For
 * every operation it analyzes the request body and each response body and
 * returns a peak-buffer budget per body, so a deployer can see, spec-wide,
 * which operations stream and which buffer (and where).
 *
 * The document must already be resolved (external `$ref`s inlined, e.g. via
 * `resolveSpec`); this walk follows only local `#/components/...` refs. It is
 * engine-free (it calls {@link analyzeStreamability}, never the streaming
 * engine), so it does not pull the engine into a consumer that only wants
 * the analysis.
 *
 * @packageDocumentation
 */

import type {
  OpenAPIDocument,
  OperationObject,
  RequestBodyObject,
  ResponseObject,
} from "@oav/core";
import {
  carryComponents,
  HTTP_METHODS,
  resolveLocalRef,
  versionFromDoc,
} from "../openapi/body-schema.js";
import type { StreamValidatorOptions } from "../options.js";
import { analyzeStreamability, type StreamabilityReport } from "./analyze.js";

/**
 * The streamability budget for one request or response body of an operation.
 * Exactly one of `report` / `error` is present: `error` holds the message
 * when the body's schema cannot be classified (an unstreamable keyword, an
 * unknown keyword, or an unresolvable `$ref`), the same failure
 * `createStreamValidator` would raise.
 *
 * @public
 */
export interface BodyBudget {
  /** Whether this is the request body or a response body. */
  role: "request" | "response";
  /** Response status key (`"200"`, `"default"`); absent for the request. */
  status?: string;
  /** The body media type (`"application/json"`, ...). */
  mediaType: string;
  /** The peak-buffer budget, when the schema classifies. */
  report?: StreamabilityReport;
  /** The classification error message, when it does not. */
  error?: string;
}

/**
 * The budget for one operation: every request/response body that carries a
 * schema, in document order (request first).
 *
 * @public
 */
export interface OperationBudget {
  /** HTTP method, upper-cased (`"POST"`). */
  method: string;
  /** Path-template key as declared (`"/pets/{id}"`). */
  path: string;
  /** Per-body budgets; empty when the operation declares no body schema. */
  bodies: BodyBudget[];
}

/**
 * A spec-wide streamability rollup. See {@link analyzeSpec}.
 *
 * @public
 */
export interface SpecBudget {
  /** One entry per operation that carries at least one body schema. */
  operations: OperationBudget[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Analyze one media-type schema, capturing a classification failure as a
// per-body error so one bad body does not abort the whole sweep.
function budgetForBody(
  doc: OpenAPIDocument,
  content: Record<string, unknown> | undefined,
  base: { role: "request" | "response"; status?: string },
  options: StreamValidatorOptions,
): BodyBudget[] {
  if (!isRecord(content)) return [];
  const out: BodyBudget[] = [];
  for (const [mediaType, mto] of Object.entries(content)) {
    const schema = isRecord(mto) ? (mto.schema as unknown) : undefined;
    if (schema === undefined) continue; // a media type with no schema is unconstrained
    const entry: BodyBudget = { ...base, mediaType };
    try {
      entry.report = analyzeStreamability(carryComponents(doc, schema as never), options);
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    out.push(entry);
  }
  return out;
}

function bodiesForOperation(
  doc: OpenAPIDocument,
  op: OperationObject,
  where: string,
  options: StreamValidatorOptions,
): BodyBudget[] {
  const bodies: BodyBudget[] = [];

  if (op.requestBody !== undefined) {
    try {
      const rb = resolveLocalRef<RequestBodyObject>(doc, op.requestBody, "requestBody", where);
      bodies.push(...budgetForBody(doc, rb.content, { role: "request" }, options));
    } catch (e) {
      bodies.push({
        role: "request",
        mediaType: "*",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const [status, responseOrRef] of Object.entries(op.responses ?? {})) {
    try {
      const resp = resolveLocalRef<ResponseObject>(
        doc,
        responseOrRef,
        "response",
        `${where} -> ${status}`,
      );
      bodies.push(...budgetForBody(doc, resp.content, { role: "response", status }, options));
    } catch (e) {
      bodies.push({
        role: "response",
        status,
        mediaType: "*",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return bodies;
}

/**
 * Roll up a streamability budget for every operation in a resolved OpenAPI
 * document. The OpenAPI version is read off `doc.openapi` (override with
 * `options.openApiVersion`) and applied to every body; other options
 * (`maxBufferedBytes`, `dialect`, ...) thread through to
 * {@link analyzeStreamability}.
 *
 * Operations with no body schema are omitted. A body whose schema cannot be
 * classified is reported with `error` set rather than throwing, so a sweep
 * over real specs surveys the whole document.
 *
 * @public
 */
export function analyzeSpec(
  doc: OpenAPIDocument,
  options: StreamValidatorOptions = {},
): SpecBudget {
  const openApiVersion = options.openApiVersion ?? versionFromDoc(doc.openapi);
  const merged: StreamValidatorOptions =
    openApiVersion === undefined ? options : { ...options, openApiVersion };

  const operations: OperationBudget[] = [];
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!isRecord(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isRecord(op)) continue;
      const where = `${method.toUpperCase()} "${path}"`;
      const bodies = bodiesForOperation(doc, op as OperationObject, where, merged);
      if (bodies.length > 0) operations.push({ method: method.toUpperCase(), path, bodies });
    }
  }
  return { operations };
}
