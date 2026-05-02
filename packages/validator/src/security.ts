import {
  createLeafError,
  type HttpRequest,
  type OpenAPIDocument,
  type OperationObject,
  type ReferenceObject,
  type SecurityRequirementObject,
  type SecuritySchemeObject,
  type ValidationError,
} from "@oav/core";

/**
 * Shape-only security check precompiled from a single OpenAPI security
 * scheme definition. Returns `null` when the request carries the
 * declared credential (presence + structural shape only); returns a
 * short human-readable reason when it doesn't. Credential verification
 * (token validity, API key lookup, password match) is outside scope —
 * that's the app's auth middleware.
 *
 * @internal
 */
interface CompiledSchemeCheck {
  scheme: string;
  check: (req: HttpRequest) => string | null;
}

/**
 * One security requirement: an AND of `CompiledSchemeCheck`s. All must
 * return `null` for the requirement to be satisfied.
 *
 * @internal
 */
export interface CompiledSecurityRequirement {
  schemes: CompiledSchemeCheck[];
}

/**
 * A pre-compiled, operation-level security check. An OR across one or
 * more `CompiledSecurityRequirement`s; at least one must fully satisfy
 * for the request to pass. `null` (stored as `undefined` on
 * `OperationCache`) means "no security required" and skips the check.
 *
 * @internal
 */
export type CompiledSecurity = CompiledSecurityRequirement[];

/**
 * Compile the effective security for one operation. Applies OAS
 * precedence: operation-level `security` (including an explicit empty
 * array opt-out) overrides `document.security`. Unknown scheme names
 * compile to always-failing checks so a typo produces a 401 rather
 * than silently passing.
 *
 * Returns `undefined` when no requirement applies (no check emitted at
 * request time): distinct from an empty array, which is never returned
 * here: empty means "no security" and we fold that into `undefined`.
 *
 * @internal
 */
export function compileOperationSecurity(
  operation: OperationObject,
  document: OpenAPIDocument,
  resolveRef: <T>(v: T | ReferenceObject | undefined) => T | undefined,
): CompiledSecurity | undefined {
  const effective = operation.security ?? document.security;
  if (effective === undefined || effective.length === 0) return undefined;

  const schemes = document.components?.securitySchemes ?? {};
  const resolvedSchemes: Record<string, SecuritySchemeObject | undefined> = {};
  for (const [name, raw] of Object.entries(schemes)) {
    resolvedSchemes[name] = resolveRef<SecuritySchemeObject>(raw);
  }

  return effective.map((req) => compileRequirement(req, resolvedSchemes));
}

function compileRequirement(
  req: SecurityRequirementObject,
  schemes: Record<string, SecuritySchemeObject | undefined>,
): CompiledSecurityRequirement {
  const compiled: CompiledSchemeCheck[] = [];
  for (const name of Object.keys(req)) {
    const scheme = schemes[name];
    compiled.push(compileSchemeCheck(name, scheme));
  }
  return { schemes: compiled };
}

function compileSchemeCheck(
  name: string,
  scheme: SecuritySchemeObject | undefined,
): CompiledSchemeCheck {
  if (scheme === undefined) {
    return {
      scheme: name,
      check: () => `"${name}" is not declared in components.securitySchemes`,
    };
  }
  switch (scheme.type) {
    case "http":
      if (scheme.scheme?.toLowerCase() === "bearer") return bearerCheck(name);
      if (scheme.scheme?.toLowerCase() === "basic") return basicCheck(name);
      // Other http schemes (digest, mutual, etc.) aren't shape-checked
      // in v1. Accept to avoid false 401s on schemes we don't yet
      // understand.
      return { scheme: name, check: () => null };
    case "apiKey":
      return apiKeyCheck(name, scheme);
    // oauth2 / openIdConnect / mutualTLS: v1 non-goals. See oav#104.
    // Treat as pass rather than block, so specs using them continue
    // to validate requests without security producing spurious 401s.
    default:
      return { scheme: name, check: () => null };
  }
}

function bearerCheck(name: string): CompiledSchemeCheck {
  return {
    scheme: name,
    check: (req) => {
      const auth = getHeader(req, "authorization");
      if (auth === undefined) return `missing "Authorization: Bearer ..." header`;
      if (!/^bearer\s+\S/i.test(auth)) return `"Authorization" is not a Bearer token`;
      return null;
    },
  };
}

function basicCheck(name: string): CompiledSchemeCheck {
  return {
    scheme: name,
    check: (req) => {
      const auth = getHeader(req, "authorization");
      if (auth === undefined) return `missing "Authorization: Basic ..." header`;
      const m = /^basic\s+(\S+)$/i.exec(auth);
      if (!m) return `"Authorization" is not a Basic credential`;
      const decoded = tryBase64Decode(m[1]!);
      if (decoded === undefined) return `"Authorization: Basic" value is not valid base64`;
      if (!decoded.includes(":")) return `"Authorization: Basic" is not "user:pass" shape`;
      return null;
    },
  };
}

function apiKeyCheck(name: string, scheme: SecuritySchemeObject): CompiledSchemeCheck {
  const keyName = scheme.name;
  const keyIn = scheme.in;
  if (!keyName || !keyIn) {
    // Malformed scheme definition: emit a failure rather than silently
    // treating every request as passing the check.
    return {
      scheme: name,
      check: () => `apiKey scheme "${name}" is missing required "name" or "in"`,
    };
  }
  return {
    scheme: name,
    check: (req) => {
      const v = pickApiKey(req, keyIn, keyName);
      if (v === undefined || v === "") return `missing ${keyIn} "${keyName}"`;
      return null;
    },
  };
}

function getHeader(req: HttpRequest, lowered: string): string | undefined {
  const raw = req.headers?.[lowered];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

function pickApiKey(
  req: HttpRequest,
  loc: "header" | "query" | "cookie",
  name: string,
): string | undefined {
  if (loc === "header") return getHeader(req, name.toLowerCase());
  if (loc === "query") {
    const q = req.query?.[name];
    return Array.isArray(q) ? q[0] : q;
  }
  return req.cookies?.[name];
}

function tryBase64Decode(s: string): string | undefined {
  try {
    // `atob` is available in Node 16+ and in every modern browser /
    // runtime; avoid a `Buffer` import to keep this file portable.
    return atob(s);
  } catch {
    return undefined;
  }
}

/**
 * Evaluate a compiled security plan against a request. OR across
 * requirements: the first passing requirement short-circuits to `null`
 * (success). If all fail, returns a single leaf `security` error
 * describing the declared alternatives.
 *
 * @internal
 */
export function checkSecurity(
  compiled: CompiledSecurity,
  req: HttpRequest,
): ValidationError | null {
  const reasons: string[] = [];
  const declared: string[][] = [];
  for (const requirement of compiled) {
    const schemeNames = requirement.schemes.map((s) => s.scheme);
    declared.push(schemeNames);
    const failures: string[] = [];
    for (const s of requirement.schemes) {
      const r = s.check(req);
      if (r !== null) failures.push(`${s.scheme}: ${r}`);
    }
    if (failures.length === 0) return null; // first satisfying alternative wins
    reasons.push(failures.join(" AND "));
  }
  const message =
    declared.length === 1
      ? `request failed security validation (${reasons[0]})`
      : `request failed security validation; no declared alternative matched: ${reasons
          .map((r, i) => `[${i}] ${r}`)
          .join(" | ")}`;
  return createLeafError("security", ["security"], message, { declared });
}
