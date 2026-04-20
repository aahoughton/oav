import { describe, expect, it } from "vitest";
import {
  builtInFormats,
  validateDate,
  validateDateTime,
  validateDuration,
  validateEmail,
  validateHostname,
  validateIdnEmail,
  validateIpv4,
  validateIpv6,
  validateJsonPointer,
  validateRegex,
  validateRelativeJsonPointer,
  validateTime,
  validateUri,
  validateUriReference,
  validateUriTemplate,
  validateUuid,
} from "../src/index.js";

describe("date / time / date-time / duration", () => {
  it("accepts RFC 3339 dates", () => {
    expect(validateDate("2024-01-31")).toBe(true);
    expect(validateDate("2024-02-29")).toBe(true);
    expect(validateDate("2023-02-29")).toBe(false);
    expect(validateDate("2024-13-01")).toBe(false);
    expect(validateDate("not a date")).toBe(false);
  });

  it("accepts RFC 3339 times with offsets", () => {
    expect(validateTime("12:34:56Z")).toBe(true);
    expect(validateTime("12:34:56+02:00")).toBe(true);
    expect(validateTime("12:34:56.789Z")).toBe(true);
    expect(validateTime("25:00:00Z")).toBe(false);
    expect(validateTime("12:34:56")).toBe(false);
  });

  it("accepts RFC 3339 date-times", () => {
    expect(validateDateTime("2024-01-31T12:34:56Z")).toBe(true);
    expect(validateDateTime("2024-01-31T12:34:56.789+02:00")).toBe(true);
    expect(validateDateTime("2024-01-31 12:34:56Z")).toBe(false);
  });

  it("accepts ISO 8601 durations", () => {
    expect(validateDuration("P1Y")).toBe(true);
    expect(validateDuration("P1Y2M10DT2H30M")).toBe(true);
    expect(validateDuration("P")).toBe(false);
    expect(validateDuration("PT")).toBe(false);
    expect(validateDuration("nope")).toBe(false);
  });
});

describe("email / hostname", () => {
  it("accepts plausible emails", () => {
    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("a.b+c@sub.example.co.uk")).toBe(true);
    expect(validateEmail("no-at-sign")).toBe(false);
    expect(validateEmail("two@@signs.com")).toBe(false);
  });

  it("accepts plausible hostnames", () => {
    expect(validateHostname("example.com")).toBe(true);
    expect(validateHostname("sub.example.com.")).toBe(true);
    expect(validateHostname("-bad.example.com")).toBe(false);
    expect(validateHostname("")).toBe(false);
  });

  it("accepts internationalized email (RFC 6531)", () => {
    // ajv-formats #66: idn-email should accept non-ASCII local part and
    // IDN domains. Samples from the Wikipedia internationalized-email
    // article.
    expect(validateIdnEmail("用户@例子.广告")).toBe(true);
    expect(validateIdnEmail("чебурашка@ящик-с-апельсинами.рф")).toBe(true);
    expect(validateIdnEmail("Dörte@Sörensen.example.com")).toBe(true);
    // Still needs an @ and a non-empty local/domain.
    expect(validateIdnEmail("用户例子.广告")).toBe(false);
    expect(validateIdnEmail("@例子.广告")).toBe(false);
  });
});

describe("ipv4 / ipv6", () => {
  it("accepts well-formed ipv4", () => {
    expect(validateIpv4("192.168.1.1")).toBe(true);
    expect(validateIpv4("0.0.0.0")).toBe(true);
    expect(validateIpv4("255.255.255.255")).toBe(true);
    expect(validateIpv4("256.1.1.1")).toBe(false);
    expect(validateIpv4("1.1.1")).toBe(false);
  });

  it("accepts well-formed ipv6", () => {
    expect(validateIpv6("2001:db8::1")).toBe(true);
    expect(validateIpv6("::1")).toBe(true);
    expect(validateIpv6("::")).toBe(true);
    expect(validateIpv6("::ffff:192.0.2.1")).toBe(true);
    expect(validateIpv6("2001:db8::")).toBe(true);
    expect(validateIpv6("2001:db8:::1")).toBe(false);
    expect(validateIpv6("not-ipv6")).toBe(false);
  });
});

describe("uri / uri-reference / uri-template", () => {
  it("accepts absolute URIs", () => {
    expect(validateUri("https://example.com/path?q=1#frag")).toBe(true);
    expect(validateUri("mailto:user@example.com")).toBe(true);
    expect(validateUri("/relative/path")).toBe(false);
  });

  it("accepts uri-references (absolute or relative)", () => {
    expect(validateUriReference("/relative/path")).toBe(true);
    expect(validateUriReference("https://example.com/")).toBe(true);
  });

  it("accepts RFC 6570 uri-templates", () => {
    expect(validateUriTemplate("/pets/{id}")).toBe(true);
    expect(validateUriTemplate("/search{?q,page}")).toBe(true);
    expect(validateUriTemplate("/pets/{id/")).toBe(false);
  });
});

describe("json-pointer", () => {
  it("accepts RFC 6901 pointers", () => {
    expect(validateJsonPointer("")).toBe(true);
    expect(validateJsonPointer("/foo/bar")).toBe(true);
    expect(validateJsonPointer("/foo~0bar~1baz")).toBe(true);
    expect(validateJsonPointer("foo")).toBe(false);
  });

  it("accepts relative pointers", () => {
    expect(validateRelativeJsonPointer("0")).toBe(true);
    expect(validateRelativeJsonPointer("2/foo/bar")).toBe(true);
    expect(validateRelativeJsonPointer("0#")).toBe(true);
    expect(validateRelativeJsonPointer("/foo")).toBe(false);
  });
});

describe("regex / uuid", () => {
  it("accepts compilable regexes", () => {
    expect(validateRegex("^x$")).toBe(true);
    expect(validateRegex("(unclosed")).toBe(false);
  });

  it("accepts RFC 4122 uuids", () => {
    expect(validateUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(validateUuid("not-a-uuid")).toBe(false);
  });
});

describe("builtInFormats map", () => {
  it("exposes every format by name", () => {
    const keys = [
      "date-time",
      "date",
      "time",
      "duration",
      "email",
      "idn-email",
      "hostname",
      "idn-hostname",
      "ipv4",
      "ipv6",
      "uri",
      "uri-reference",
      "iri",
      "iri-reference",
      "uri-template",
      "json-pointer",
      "relative-json-pointer",
      "regex",
      "uuid",
    ];
    for (const k of keys) expect(typeof builtInFormats[k]).toBe("function");
  });
});
