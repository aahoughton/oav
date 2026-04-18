import { describe, expect, it } from "vitest";
import { detectOpenAPIVersion } from "../src/version.js";

describe("detectOpenAPIVersion", () => {
  it("buckets 3.0.x into '3.0'", () => {
    expect(detectOpenAPIVersion({ openapi: "3.0.0" })).toBe("3.0");
    expect(detectOpenAPIVersion({ openapi: "3.0.3" })).toBe("3.0");
    expect(detectOpenAPIVersion({ openapi: "3.0.4" })).toBe("3.0");
  });

  it("buckets 3.1.x into '3.1'", () => {
    expect(detectOpenAPIVersion({ openapi: "3.1.0" })).toBe("3.1");
    expect(detectOpenAPIVersion({ openapi: "3.1.1" })).toBe("3.1");
  });

  it("buckets 3.2.x into '3.2'", () => {
    expect(detectOpenAPIVersion({ openapi: "3.2.0" })).toBe("3.2");
    expect(detectOpenAPIVersion({ openapi: "3.2.0-rc1" })).toBe("3.2");
  });

  it("returns undefined for Swagger 2.x (openapi field missing)", () => {
    expect(detectOpenAPIVersion({ swagger: "2.0" })).toBeUndefined();
  });

  it("returns undefined for unrecognised major.minor", () => {
    expect(detectOpenAPIVersion({ openapi: "4.0.0" })).toBeUndefined();
    expect(detectOpenAPIVersion({ openapi: "3.3.0" })).toBeUndefined();
  });

  it("returns undefined on malformed / non-object input without throwing", () => {
    expect(detectOpenAPIVersion({ openapi: "not a version" })).toBeUndefined();
    expect(detectOpenAPIVersion({ openapi: 3.1 })).toBeUndefined();
    expect(detectOpenAPIVersion({})).toBeUndefined();
    expect(detectOpenAPIVersion(null)).toBeUndefined();
    expect(detectOpenAPIVersion("string")).toBeUndefined();
    expect(detectOpenAPIVersion(undefined)).toBeUndefined();
  });
});
