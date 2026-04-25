import type { Request, RequestHandler } from "express";
import type { HttpRequest } from "@oav/core";
import type { Validator } from "@oav/validator";
import { httpRequestFromExpress } from "./extract.js";
import { renderProblemDetails } from "./render.js";
import type { ErrorHandler, ExpressContext } from "./types.js";

/**
 * Options for {@link validateRequests}. Names and semantics are
 * shared with future {@link validateResponses} and with the same
 * options on every other adapter in the family (`oav-express4`,
 * `oav-fastify`, ...) — only the framework-typed argument differs.
 *
 * @public
 */
export interface ValidateRequestsOptions {
  /**
   * Custom extractor from the Express request to oav's
   * {@link HttpRequest} shape. Default: {@link httpRequestFromExpress}.
   * Override when your stack populates non-standard fields the
   * validator needs (e.g. a proxy that puts the verified body on
   * `req.verifiedBody`).
   */
  toHttpRequest?: (req: Request) => HttpRequest;
  /**
   * Called when {@link Validator.validateRequest} returns an error.
   * Default: {@link renderProblemDetails} — RFC 9457
   * `application/problem+json` with status from `httpStatusFor`.
   * Pass your own to render a custom envelope, call `next(err)`,
   * map to a different status, etc. The middleware does not call
   * `next()` after invoking `onError` — the callback is the response.
   */
  onError?: ErrorHandler<ExpressContext>;
}

/**
 * Build an Express 5 request-handler that runs every request through
 * a {@link Validator} and either calls `next()` (valid) or invokes
 * the configured `onError` (invalid). The default `onError` writes
 * an RFC 9457 problem-details response.
 *
 * Plural (`validateRequests`, not `validateRequest`) because the
 * middleware intercepts every request — the singular form is the
 * Validator's own per-call method.
 *
 * Express 5 is promise-native: this middleware is `async`, and
 * thrown exceptions / rejected promises propagate to the host's
 * error middleware automatically. No try/catch wrapper needed.
 *
 * Pairs with sibling `validateRequests` in `oav-express4`, future
 * `oav-fastify`, etc. Same factory shape across the family.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { validateRequests } from "@aahoughton/oav-express5";
 *
 * const app = express();
 * app.use(express.json());
 * app.use(validateRequests(validator));
 * ```
 *
 * @public
 */
export function validateRequests(
  validator: Validator,
  options: ValidateRequestsOptions = {},
): RequestHandler {
  const toHttpRequest = options.toHttpRequest ?? httpRequestFromExpress;
  const onError = options.onError ?? renderProblemDetails;

  return async (req, res, next) => {
    const httpReq = toHttpRequest(req);
    const err = validator.validateRequest(httpReq);
    if (err === null) {
      next();
      return;
    }
    // Express 5 awaits the returned promise; thrown errors and
    // rejected promises propagate to the host's error middleware.
    // Sync onError handlers complete inline; async ones get awaited.
    await onError(err, { req, res, next });
  };
}
