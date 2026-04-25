import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { httpRequestFromExpress } from "../src/extract.js";

function fakeReq(overrides: Partial<Request>): Request {
  return overrides as unknown as Request;
}

describe("httpRequestFromExpress", () => {
  it("extracts method, path, headers, contentType, query, and body", () => {
    const got = httpRequestFromExpress(
      fakeReq({
        method: "post",
        path: "/pets",
        headers: { "content-type": "application/json", "x-tenant": "t1" },
        query: { limit: "10" },
        body: { name: "Fido" },
      }),
    );
    expect(got.method).toBe("POST");
    expect(got.path).toBe("/pets");
    expect(got.contentType).toBe("application/json");
    expect(got.query).toEqual({ limit: "10" });
    expect(got.body).toEqual({ name: "Fido" });
  });

  it("lowercases header keys defensively", () => {
    const got = httpRequestFromExpress(
      fakeReq({
        method: "GET",
        path: "/x",
        headers: { "X-Custom": "v1", "Content-Type": "application/json" },
      }),
    );
    expect(got.headers).toEqual({ "x-custom": "v1", "content-type": "application/json" });
  });

  it("omits cookies when cookie-parser hasn't run", () => {
    const got = httpRequestFromExpress(fakeReq({ method: "GET", path: "/x", headers: {} }));
    expect(got.cookies).toBeUndefined();
  });

  it("propagates cookies when present", () => {
    const got = httpRequestFromExpress(
      fakeReq({
        method: "GET",
        path: "/x",
        headers: {},
        cookies: { sid: "abc" },
      } as Partial<Request> & { cookies: Record<string, string> }),
    );
    expect(got.cookies).toEqual({ sid: "abc" });
  });

  it("omits body when undefined (e.g. express.json() didn't fire)", () => {
    const got = httpRequestFromExpress(
      fakeReq({ method: "POST", path: "/x", headers: { "content-type": "text/plain" } }),
    );
    expect(got.body).toBeUndefined();
    expect(got.contentType).toBe("text/plain");
  });

  it("does not include the query string in path (req.path strips it)", () => {
    const got = httpRequestFromExpress(
      fakeReq({ method: "GET", path: "/pets", query: { limit: "10" }, headers: {} }),
    );
    expect(got.path).toBe("/pets");
    expect(got.path).not.toContain("?");
  });
});
