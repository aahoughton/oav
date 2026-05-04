import { allowHeaderFor, httpStatusFor, toProblemDetails, type ValidationError } from "@oav/core";
import type { ExpressContext } from "./types.js";

/**
 * The default `onError` for {@link validateRequests}. Renders the
 * validation tree as an RFC 9457 `application/problem+json` response:
 * status from {@link httpStatusFor}, `Allow` header from
 * {@link allowHeaderFor} on a 405, body from {@link toProblemDetails}
 * (whose `detail` is the first failing leaf via
 * {@link formatSummary}).
 *
 * Exported standalone for two cases:
 *
 * 1. You want oav's rendering as the fallback in your own
 *    middleware: call this directly when you don't want to handle
 *    the error yourself.
 * 2. You want a slightly different renderer: use this as the
 *    starting point and adjust (e.g. swap the body, override the
 *    status, add headers).
 *
 * @public
 */
export function renderProblemDetails(err: ValidationError, ctx: ExpressContext): void {
  const allow = allowHeaderFor(err);
  if (allow !== undefined) ctx.res.setHeader("Allow", allow);
  ctx.res
    .status(httpStatusFor(err))
    .type("application/problem+json")
    .json(toProblemDetails(err, { instance: ctx.req.originalUrl }));
}
