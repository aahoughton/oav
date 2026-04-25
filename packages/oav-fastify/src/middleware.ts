import type { FastifyRequest, preValidationHookHandler } from "fastify";
import type { HttpRequest } from "@oav/core";
import type { Validator } from "@oav/validator";
import { httpRequestFromFastify } from "./extract.js";
import { renderProblemDetails } from "./render.js";
import type { ErrorHandler, FastifyContext } from "./types.js";

/**
 * Options for {@link validateRequests}. Names and semantics are
 * shared with future {@link validateResponses} and with the same
 * options on every other adapter in the family (`oav-express4`,
 * `oav-express5`, future `oav-hono`, ...) — only the
 * framework-typed argument differs.
 *
 * @public
 */
export interface ValidateRequestsOptions {
  /**
   * Custom extractor from the Fastify request to oav's
   * {@link HttpRequest} shape. Default: {@link httpRequestFromFastify}.
   * Override when your stack populates non-standard fields the
   * validator needs (e.g. a proxy that puts the verified body on
   * `request.verifiedBody`).
   */
  toHttpRequest?: (request: FastifyRequest) => HttpRequest;
  /**
   * Called when {@link Validator.validateRequest} returns an error.
   * Default: {@link renderProblemDetails} — RFC 9457
   * `application/problem+json` with status from `httpStatusFor`.
   * Pass your own to render a custom envelope, throw (handed to
   * Fastify's error handler), map to a different status, etc. The
   * hook does not call `reply.send()` after invoking `onError` —
   * the callback is the response.
   */
  onError?: ErrorHandler<FastifyContext>;
}

/**
 * Build a Fastify `preValidation` hook that runs every request
 * through a {@link Validator} and either resolves (valid) or
 * invokes the configured `onError` (invalid). The default
 * `onError` writes an RFC 9457 problem-details response.
 *
 * Plural (`validateRequests`, not `validateRequest`) because the
 * hook intercepts every request — the singular form is the
 * Validator's own per-call method.
 *
 * Mount on `preValidation` so it runs after Fastify's content-type
 * parsers (which populate `request.body`) but before route
 * handlers and Fastify's own per-route schema validation (which
 * runs in the `validation` step). Both can coexist — Fastify's own
 * per-route schemas run after this hook; oav's failures are
 * surfaced first.
 *
 * Pairs with sibling `validateRequests` in `oav-express4` /
 * `oav-express5`. Same factory shape across the family; only the
 * returned framework-native handler differs.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import { validateRequests } from "@aahoughton/oav-fastify";
 *
 * const app = Fastify();
 * app.addHook("preValidation", validateRequests(validator));
 * ```
 *
 * @public
 */
export function validateRequests(
  validator: Validator,
  options: ValidateRequestsOptions = {},
): preValidationHookHandler {
  const toHttpRequest = options.toHttpRequest ?? httpRequestFromFastify;
  const onError = options.onError ?? renderProblemDetails;

  return async (request, reply) => {
    const httpReq = toHttpRequest(request);
    const err = validator.validateRequest(httpReq);
    if (err === null) return;
    // Fastify awaits the returned promise; thrown errors / rejected
    // promises propagate to Fastify's error handler. The hook
    // returns once onError settles — Fastify treats a sent reply
    // as "we handled it, skip the route handler."
    await onError(err, { request, reply });
  };
}
