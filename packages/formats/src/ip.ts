/**
 * IPv4 / IPv6 format validators.
 *
 * @packageDocumentation
 */

const IPV4_OCTET_RE = /^(?:0|[1-9]\d{0,2})$/;

/**
 * RFC 2673 `ipv4` (e.g. `"192.168.1.1"`).
 *
 * @public
 */
export function validateIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!IPV4_OCTET_RE.test(p)) return false;
    const n = Number.parseInt(p, 10);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * RFC 4291 `ipv6` (e.g. `"2001:db8::1"`). Supports compressed forms and
 * embedded IPv4 (e.g. `"::ffff:192.0.2.1"`).
 *
 * @public
 */
export function validateIpv6(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false;
  let addr = value;
  // embedded IPv4
  const lastColon = addr.lastIndexOf(":");
  const tail = lastColon >= 0 ? addr.slice(lastColon + 1) : "";
  if (tail.includes(".")) {
    if (!validateIpv4(tail)) return false;
    addr = addr.slice(0, lastColon + 1) + "0:0";
  }

  const doubleColonCount = (addr.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return false;

  let groups: string[];
  if (doubleColonCount === 1) {
    const [head, tailGroups] = addr.split("::");
    const headParts = head === "" ? [] : (head ?? "").split(":");
    const tailParts = tailGroups === "" ? [] : (tailGroups ?? "").split(":");
    if (headParts.length + tailParts.length >= 8) return false;
    const fill = Array.from({ length: 8 - headParts.length - tailParts.length }, () => "0");
    groups = [...headParts, ...fill, ...tailParts];
  } else {
    groups = addr.split(":");
    if (groups.length !== 8) return false;
  }
  if (groups.length !== 8) return false;
  const GROUP_RE = /^[0-9a-fA-F]{1,4}$/;
  return groups.every((g) => GROUP_RE.test(g));
}
