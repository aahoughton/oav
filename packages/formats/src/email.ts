/**
 * Email format validators. These are pragmatic — the full RFC 5321 grammar
 * is enormous and most real-world "email validators" reject too few
 * strings. We allow any ASCII local-part + a sensible domain.
 *
 * @packageDocumentation
 */

import { validateHostname, validateIdnHostname } from "./hostname.js";

const EMAIL_LOCAL_RE = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~.-]+$/;

/**
 * RFC 5321-ish `email` (ASCII).
 *
 * @public
 */
export function validateEmail(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at < 1 || at >= value.length - 1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!EMAIL_LOCAL_RE.test(local)) return false;
  return validateHostname(domain);
}

/**
 * RFC 6531 internationalized `email`.
 *
 * @public
 */
export function validateIdnEmail(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at < 1 || at >= value.length - 1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[^\s@]+$/.test(local)) return false;
  return validateIdnHostname(domain);
}
