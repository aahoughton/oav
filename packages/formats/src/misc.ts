/**
 * Miscellaneous format validators: regex, uuid.
 *
 * @packageDocumentation
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * RFC 4122 `uuid`.
 *
 * @public
 */
export function validateUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * ECMA 262 `regex`: the value must compile as a JavaScript regular
 * expression with the `u` flag (per JSON Schema 2020-12 recommendation).
 *
 * Standalone utility. `compileSchema` no longer wires this into
 * `builtInFormats`: the schema compiler registers its own `regex`
 * format inside `createDeps` so it shares the `regexCompiler` hook
 * with the `pattern` keyword. Reach for this function directly when
 * you want u-mode strictness independent of whatever compiler is
 * configured.
 *
 * @public
 */
export function validateRegex(value: string): boolean {
  try {
    new RegExp(value, "u");
    return true;
  } catch {
    return false;
  }
}
