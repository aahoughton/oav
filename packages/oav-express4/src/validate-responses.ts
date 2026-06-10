import type { Request, RequestHandler, Response } from "express";
import {
  collectLeaves,
  type HttpRequest,
  type HttpResponse,
  type ValidationError,
} from "@oav/core";
import type { TreeValidator, Validator } from "@oav/validator";
import { httpRequestFromExpress } from "./extract.js";
import { ResponseValidationError } from "./response-error.js";
import type { ErrorHandler, ExpressContext } from "./types.js";

/**
 * Options for {@link validateResponses}. The same option shape is used
 * by every adapter in the family (`oav-express5`, `oav-fastify`); only
 * the framework-typed argument differs.
 *
 * @public
 */
export interface ValidateResponsesOptions {
  /**
   * Custom extractor from the Express request to oav's
   * {@link HttpRequest} shape, used only to match the operation the
   * response answers (method + path). Default:
   * {@link httpRequestFromExpress}.
   */
  toHttpRequest?: (req: Request) => HttpRequest;
  /**
   * Predicate gating which response statuses are validated. Return
   * `true` to validate, `false` to pass the response through untouched.
   * Default: validate every status. Use it to scope validation (e.g.
   * `(s) => s < 500` to skip server-error pages, or `(s) => s < 300` for
   * success-only). A response whose status the spec doesn't declare is a
   * finding (the validator emits a `status` leaf); narrow this predicate
   * to ignore statuses you don't want checked.
   */
  statuses?: (status: number) => boolean;
  /**
   * Called when {@link Validator.validateResponse} returns an error.
   * Default: throw a {@link ResponseValidationError}, which the adapter
   * forwards to the host's error middleware via `next(err)` (a failing
   * response is a server bug, so it surfaces as a 500 rather than being
   * rendered here).
   *
   * The callback decides what happens next:
   * - **Throw** (the default) to forward to the host error handler.
   * - **Return normally** to let the original (invalid) response body go
   *   out anyway. This is the log-and-continue path: log the finding and
   *   return; the body is sent unchanged.
   * - **Render your own response** (`ctx.res.status(...).json(...)`) and
   *   return; once the response is sent the adapter does not also send
   *   the original.
   *
   * May be async; the original body is sent (or not) after it settles.
   */
  onError?: ErrorHandler<ExpressContext>;
}

const defaultOnError: ErrorHandler<ExpressContext> = (errors) => {
  throw new ResponseValidationError(errors);
};

// Marks a response already wrapped by validateResponses; a second
// mount on the same chain is a configuration error (it would validate
// every response twice and can fire onError twice for one failure).
const WRAPPED = Symbol("oav.validateResponses");

// res.getHeaders() reports numeric values (Content-Length, or any
// res.setHeader(name, number)) as numbers; the validator's header
// deserializer expects strings.
function responseHeaders(res: Response): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(res.getHeaders())) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value : String(value);
  }
  return headers;
}

/**
 * Build an Express 4 middleware that validates every outgoing response
 * against the spec. It wraps `res.json` / `res.send` so that when a
 * route handler sends a JSON body, the body is checked against the
 * response declared for its status before it goes out; on failure the
 * configured `onError` runs (default: throw, forwarded to the host
 * error handler as a 500).
 *
 * Opt-in and explicit: mount it only where you want response checking
 * (typically on in development, off in production via a conditional
 * mount). This is the one place an adapter wraps `res`; the core
 * `validateResponse` stays a pure function that reads its arguments. See
 * the migration note in `docs/migration-from-eov.md`. Mounting it twice
 * on one route chain is a configuration error; the second mount fails
 * the request via `next(err)` with a clear message instead of validating
 * every response twice.
 *
 * Only JSON responses are validated: `res.json(obj)`, `res.send(obj)`
 * (which Express routes through `json`), and `res.send(jsonString)` when
 * the content type is JSON. Non-JSON `send` payloads, `res.end`, and
 * streamed responses pass through untouched. So does `res.jsonp` when a
 * callback parameter is present (the payload goes out as JavaScript);
 * without one Express serves plain JSON and it is validated. Express 4's
 * deprecated two-argument forms (`res.json(status, obj)`,
 * `res.send(body, status)`, and friends) are forwarded to Express
 * untouched, status and body intact; Express disambiguates them itself,
 * and once it has (status set, body serialized) the re-dispatch through
 * `send` still validates a JSON body against the actual status. A
 * per-response guard means the error handler's own response (rendered in
 * reaction to a failure) is not itself re-validated, so there is no
 * loop.
 *
 * @example
 * ```ts
 * import { validateRequests, validateResponses } from "@aahoughton/oav-express4";
 *
 * app.use(validateRequests(validator));
 * if (process.env.NODE_ENV !== "production") {
 *   app.use(validateResponses(validator));
 * }
 * ```
 *
 * @public
 */
export function validateResponses(
  validator: Validator | TreeValidator,
  options: ValidateResponsesOptions = {},
): RequestHandler {
  if (validator.output === "predicate") {
    throw new Error(
      'validateResponses: a predicate-mode validator (output: "predicate") cannot report which ' +
        'response fields failed. Build the validator with output: "flat" (default) or "tree".',
    );
  }
  const toHttpRequest = options.toHttpRequest ?? httpRequestFromExpress;
  const shouldValidate = options.statuses ?? (() => true);
  const onError = options.onError ?? defaultOnError;

  return (req, res, next) => {
    const marked = res as Response & { [WRAPPED]?: boolean };
    if (marked[WRAPPED] === true) {
      next(
        new Error(
          "validateResponses: res is already wrapped (middleware mounted twice on this route chain); mount it once",
        ),
      );
      return;
    }
    marked[WRAPPED] = true;

    let httpReq: HttpRequest;
    try {
      httpReq = toHttpRequest(req);
    } catch (e) {
      next(e);
      return;
    }

    // Per-response guard: validate at most once, so the error handler's
    // own response (sent through this same wrapped res) is not
    // re-validated into a loop.
    let handled = false;

    // Returns the failing leaves, or null when the response is valid,
    // skipped by the status predicate, or already handled.
    const check = (body: unknown, contentType: string): ValidationError[] | null => {
      if (handled) return null;
      handled = true;
      if (!shouldValidate(res.statusCode)) return null;
      const httpRes: HttpResponse = {
        status: res.statusCode,
        contentType,
        headers: responseHeaders(res),
        body,
      };
      const result = validator.validateResponse(httpReq, httpRes);
      if (result.valid) return null;
      return "errors" in result ? result.errors : collectLeaves(result.error);
    };

    // Run onError; on normal completion send the original body (unless
    // onError already sent one), on throw / rejection forward to the
    // host error handler. Stays synchronous for a sync onError so the
    // response settles in the same tick.
    const handleFailure = (errors: ValidationError[], sendOriginal: () => void): void => {
      const sendIfUnsent = (): void => {
        if (!res.headersSent) sendOriginal();
      };
      try {
        const maybe = onError(errors, { req, res, next });
        if (maybe !== undefined && typeof (maybe as Promise<void>).then === "function") {
          (maybe as Promise<void>).then(sendIfUnsent).catch(next);
        } else {
          sendIfUnsent();
        }
      } catch (e) {
        next(e);
      }
    };

    const originalJson = res.json.bind(res) as (...args: unknown[]) => Response;
    const originalSend = res.send.bind(res) as (...args: unknown[]) => Response;

    res.json = ((...args: unknown[]): Response => {
      // Express 4's deprecated two-argument forms (res.json(status, obj),
      // res.json(obj, status)) disambiguate inside Express; forward them
      // rather than guessing which argument is the body. Express then
      // re-dispatches through send with the status set and the body
      // serialized, and validation happens there.
      if (args.length > 1) return originalJson(...args);
      const body = args[0];
      const contentType =
        (res.getHeader("content-type") as string | undefined) ?? "application/json";
      const errors = check(body, contentType);
      if (errors !== null) {
        handleFailure(errors, () => originalJson(...args));
        return res;
      }
      return originalJson(...args);
    }) as Response["json"];

    res.send = ((...args: unknown[]): Response => {
      // Deprecated two-argument forms are forwarded, as in res.json
      // above; an object body still validates via Express's re-dispatch
      // through json.
      if (args.length > 1) return originalSend(...args);
      const body = args[0];
      // Objects route through res.json internally (and are validated
      // there); only a JSON string needs handling here. The handled gate
      // also covers the re-entry from a validated res.json (originalJson
      // serializes and re-dispatches through send); without it every
      // JSON response would be fully re-parsed just for check() to
      // discard the result.
      if (!handled && typeof body === "string") {
        const contentType = String(res.getHeader("content-type") ?? "");
        if (/\bjson\b/i.test(contentType)) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = undefined;
          }
          if (parsed !== undefined) {
            const errors = check(parsed, contentType);
            if (errors !== null) {
              handleFailure(errors, () => originalSend(...args));
              return res;
            }
          }
        }
      }
      return originalSend(...args);
    }) as Response["send"];

    next();
  };
}
