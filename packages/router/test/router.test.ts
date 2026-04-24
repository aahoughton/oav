import { describe, expect, it } from "vitest";
import type { PathItem } from "@oav/core";
import { createRouter, parseTemplate } from "../src/matcher.js";

const op = (id: string) => ({ operationId: id, responses: { "200": { description: "ok" } } });

describe("parseTemplate", () => {
  it("splits on slashes and identifies {param} segments", () => {
    expect(parseTemplate("/pets/{id}/tags/{tag}")).toEqual([
      { kind: "literal", value: "pets" },
      { kind: "template", name: "id" },
      { kind: "literal", value: "tags" },
      { kind: "template", name: "tag" },
    ]);
  });

  it("returns [] for root path", () => {
    expect(parseTemplate("/")).toEqual([]);
  });
});

describe("router", () => {
  const paths: Record<string, PathItem> = {
    "/pets": { get: op("listPets"), post: op("createPet") },
    "/pets/{id}": { get: op("getPet"), put: op("replacePet") },
    "/pets/mine": { get: op("mine") },
    "/pets/{id}/tags/{tag}": { get: op("getTag") },
  };
  const r = createRouter(paths);

  it("matches exact literal paths", () => {
    const m = r.match("get", "/pets");
    expect(m?.operation.operationId).toBe("listPets");
    expect(m?.pathParams).toEqual({});
  });

  it("matches template parameters and extracts them", () => {
    const m = r.match("get", "/pets/42");
    expect(m?.operation.operationId).toBe("getPet");
    expect(m?.pathParams).toEqual({ id: "42" });
  });

  it("picks the literal specificity winner over a template sibling", () => {
    const m = r.match("get", "/pets/mine");
    expect(m?.operation.operationId).toBe("mine");
  });

  it("matches methods independently on the same path", () => {
    expect(r.match("get", "/pets")?.kind).toBe("match");
    expect(r.match("post", "/pets")?.kind).toBe("match");
    // DELETE isn't declared on /pets → method-not-allowed, not a path miss.
    const m = r.match("delete", "/pets");
    expect(m?.kind).toBe("method-not-allowed");
  });

  it("decodes percent-encoded segments", () => {
    const m = r.match("get", "/pets/foo%2Fbar");
    expect(m?.pathParams).toEqual({ id: "foo/bar" });
  });

  it("ignores trailing slashes", () => {
    expect(r.match("get", "/pets/")?.operation.operationId).toBe("listPets");
  });

  it("ignores query strings", () => {
    expect(r.match("get", "/pets?limit=10")?.operation.operationId).toBe("listPets");
  });

  it("returns undefined for unknown paths", () => {
    expect(r.match("get", "/vets")).toBeUndefined();
    expect(r.match("get", "/pets/1/2/3")).toBeUndefined();
  });

  it("handles method casing", () => {
    expect(r.match("GET", "/pets")?.operation.operationId).toBe("listPets");
    expect(r.match("Get", "/pets")?.operation.operationId).toBe("listPets");
  });

  it("extracts multiple template params", () => {
    const m = r.match("get", "/pets/42/tags/vet");
    expect(m?.pathParams).toEqual({ id: "42", tag: "vet" });
  });

  it("routes HEAD to the GET operation when no explicit HEAD is declared", () => {
    // RFC 9110 §9.3.2: resources that answer GET must answer HEAD.
    const m = r.match("head", "/pets");
    expect(m?.operation.operationId).toBe("listPets");
  });

  it("prefers an explicit HEAD operation over the GET fallback", () => {
    const paths2: Record<string, PathItem> = {
      "/pets": { get: op("listPets"), head: op("headPets") },
    };
    const r2 = createRouter(paths2);
    expect(r2.match("head", "/pets")?.operation.operationId).toBe("headPets");
  });

  it("does not invent a HEAD route when the path has no GET", () => {
    const paths2: Record<string, PathItem> = { "/write-only": { post: op("post") } };
    const r2 = createRouter(paths2);
    // Path matches; HEAD isn't implicitly available without GET → 405.
    const m = r2.match("head", "/write-only");
    expect(m?.kind).toBe("method-not-allowed");
  });

  it("matches path segments containing a literal colon", () => {
    const p: Record<string, PathItem> = { "/users/me:follow": { get: op("follow") } };
    const rc = createRouter(p);
    expect(rc.match("get", "/users/me:follow")?.operation.operationId).toBe("follow");
  });

  it("decodes percent-encoded colons in request paths", () => {
    const p: Record<string, PathItem> = { "/users/me:follow": { get: op("follow") } };
    const rc = createRouter(p);
    expect(rc.match("get", "/users/me%3Afollow")?.operation.operationId).toBe("follow");
  });

  it("rejects two path templates that differ only in parameter names when methods overlap", () => {
    expect(() =>
      createRouter({
        "/items/{id}": { get: op("byId") },
        "/items/{slug}": { get: op("bySlug") },
      }),
    ).toThrow(/both declare GET/);
  });

  it("allows structurally-identical templates with disjoint methods", () => {
    // Real-world pattern from GitHub / Jira / Gmail / several AWS specs:
    // two paths describing the same URL shape but disjoint HTTP methods
    // (e.g. one declares only DELETE, the other only GET). They never
    // collide at match time, so construction must not throw.
    const rc = createRouter({
      "/orgs/{org}/attestations/{attestation_id}": { delete: op("deleteById") },
      "/orgs/{org}/attestations/{subject_digest}": { get: op("listByDigest") },
    });
    const del = rc.match("delete", "/orgs/acme/attestations/42");
    expect(del?.operation.operationId).toBe("deleteById");
    expect(del?.pathParams).toEqual({ org: "acme", attestation_id: "42" });
    const get = rc.match("get", "/orgs/acme/attestations/sha256:abc");
    expect(get?.operation.operationId).toBe("listByDigest");
    expect(get?.pathParams).toEqual({ org: "acme", subject_digest: "sha256:abc" });
  });

  it("flags GET-vs-explicit-HEAD as ambiguous on identical structure", () => {
    // GET implicitly answers HEAD via the runtime fallback (RFC 9110).
    // A sibling pattern declaring explicit HEAD on the same structure
    // would silently win at match time depending on sort order — surface
    // it at construction.
    expect(() =>
      createRouter({
        "/things/{id}": { get: op("get") },
        "/things/{slug}": { head: op("head") },
      }),
    ).toThrow(/both declare HEAD/);
  });

  it("ignores path items declaring no methods when checking ambiguity", () => {
    // A PathItem with only `parameters` and no methods can never match
    // a request, so it shouldn't conflict with a sibling that does.
    expect(() =>
      createRouter({
        "/things/{id}": { get: op("get") },
        "/things/{slug}": { parameters: [] } as PathItem,
      }),
    ).not.toThrow();
  });

  it("returns method-not-allowed with an allowed set (405 shape)", () => {
    const m = r.match("delete", "/pets");
    expect(m).toEqual({
      kind: "method-not-allowed",
      pathPattern: "/pets",
      allowed: ["GET", "HEAD", "POST"],
    });
  });

  it("unions allowed methods across every path template that matches the path", () => {
    // /items/42 and /items/{id} both structurally match POST /items/42.
    // Neither declares POST, so the allowed union is {GET (from /items/42),
    // HEAD (implicit via GET), PUT (from /items/{id})}.
    const rc = createRouter({
      "/items/42": { get: op("literal") },
      "/items/{id}": { put: op("byId") },
    });
    const m = rc.match("post", "/items/42");
    expect(m).toEqual({
      kind: "method-not-allowed",
      pathPattern: "/items/42",
      allowed: ["GET", "HEAD", "PUT"],
    });
  });

  it("falls through to a matching method on a less-specific path", () => {
    // /items/42 has GET only; /items/{id} has POST. A POST /items/42
    // should hit the {id} route, not return method-not-allowed.
    const rc = createRouter({
      "/items/42": { get: op("literal") },
      "/items/{id}": { post: op("byId") },
    });
    const m = rc.match("post", "/items/42");
    expect(m?.kind).toBe("match");
    if (m?.kind === "match") {
      expect(m.operation.operationId).toBe("byId");
      expect(m.pathPattern).toBe("/items/{id}");
    }
  });
});
