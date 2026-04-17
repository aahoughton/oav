import { describe, expect, it } from "vitest";
import { parseHttpFile } from "../src/http-parser.js";

describe("parseHttpFile", () => {
  it("parses a method, path, query, headers, and JSON body", () => {
    const text =
      "POST /pets?limit=10&tag=dog HTTP/1.1\n" +
      "Content-Type: application/json\n" +
      "X-Tenant-Id: abc-123\n" +
      "\n" +
      '{"name":"Fido","species":"dog"}';
    const req = parseHttpFile(text);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/pets");
    expect(req.query).toEqual({ limit: "10", tag: "dog" });
    expect(req.contentType).toBe("application/json");
    expect(req.headers?.["x-tenant-id"]).toBe("abc-123");
    expect(req.body).toEqual({ name: "Fido", species: "dog" });
  });

  it("accepts CRLF line endings", () => {
    const text = "GET /x HTTP/1.1\r\nX-H: v\r\n\r\n";
    const req = parseHttpFile(text);
    expect(req.method).toBe("GET");
    expect(req.headers?.["x-h"]).toBe("v");
  });

  it("returns undefined body when none is provided", () => {
    const req = parseHttpFile("GET /pets HTTP/1.1\n\n");
    expect(req.body).toBeUndefined();
  });

  it("keeps a non-JSON body as a raw string", () => {
    const text = "POST /p HTTP/1.1\nContent-Type: text/plain\n\nhello world";
    const req = parseHttpFile(text);
    expect(req.body).toBe("hello world");
  });

  it("throws on a missing request line", () => {
    expect(() => parseHttpFile("")).toThrow();
  });
});
