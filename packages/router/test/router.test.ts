import { describe, expect, it } from "vitest";
import type { PathItem } from "@oav/core";
import { createRouter, parseTemplate } from "../src/trie.js";

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
    expect(r.match("get", "/pets")?.operation.operationId).toBe("listPets");
    expect(r.match("post", "/pets")?.operation.operationId).toBe("createPet");
    expect(r.match("delete", "/pets")).toBeUndefined();
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
});
