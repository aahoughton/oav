import { type OpenAPIDocument } from "@oav/core";
import { createValidator } from "@oav/validator";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { ResponseValidationError } from "../src/response-error.js";
import { validateResponses } from "../src/validate-responses.js";

function widgetSpec(): OpenAPIDocument {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths: {
      "/widgets/{id}": {
        get: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id"],
                    properties: { id: { type: "string" } },
                    additionalProperties: false,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

interface FakeRes {
  res: Response;
  sentJson: ReturnType<typeof vi.fn>;
  sentSend: ReturnType<typeof vi.fn>;
}

function fakeRes(statusCode = 200, headers: Record<string, string> = {}): FakeRes {
  const sentJson = vi.fn();
  const sentSend = vi.fn();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const res = {
    statusCode,
    getHeader: (n: string) => lower[n.toLowerCase()],
    getHeaders: () => lower,
    json(body: unknown) {
      sentJson(body);
      return this;
    },
    send(body: unknown) {
      sentSend(body);
      return this;
    },
  };
  return { res: res as unknown as Response, sentJson, sentSend };
}

function fakeReq(): Request {
  return {
    method: "GET",
    path: "/widgets/42",
    headers: {},
    originalUrl: "/widgets/42",
  } as unknown as Request;
}

const v = createValidator(widgetSpec());

function erroredWith(next: ReturnType<typeof vi.fn>): ResponseValidationError | undefined {
  const call = next.mock.calls.find((c) => c[0] instanceof ResponseValidationError);
  return call?.[0] as ResponseValidationError | undefined;
}

describe("validateResponses (Express 5)", () => {
  it("rejects a predicate-mode validator at construction", () => {
    const predicate = createValidator(widgetSpec(), { output: "predicate" });
    expect(() => validateResponses(predicate as never)).toThrow(/predicate-mode/);
  });

  it("sends a valid response body through unchanged", () => {
    const { res, sentJson } = fakeRes();
    const next = vi.fn();
    validateResponses(v)(fakeReq(), res, next as unknown as NextFunction);
    res.json({ id: "ok" });
    expect(sentJson).toHaveBeenCalledWith({ id: "ok" });
    expect(erroredWith(next)).toBeUndefined();
  });

  it("forwards a ResponseValidationError and suppresses the bad body", () => {
    const { res, sentJson } = fakeRes();
    const next = vi.fn();
    validateResponses(v)(fakeReq(), res, next as unknown as NextFunction);
    res.json({ id: 123 }); // id must be a string
    expect(sentJson).not.toHaveBeenCalled();
    const err = erroredWith(next);
    expect(err).toBeInstanceOf(ResponseValidationError);
    expect(err?.statusCode).toBe(500);
    expect(err?.errors.length).toBeGreaterThan(0);
  });

  it("treats an undeclared status as a finding by default", () => {
    const { res, sentJson } = fakeRes(418);
    const next = vi.fn();
    validateResponses(v)(fakeReq(), res, next as unknown as NextFunction);
    res.json({ id: "ok" });
    expect(sentJson).not.toHaveBeenCalled();
    expect(erroredWith(next)).toBeInstanceOf(ResponseValidationError);
  });

  it("skips statuses the predicate excludes", () => {
    const { res, sentJson } = fakeRes(500);
    const next = vi.fn();
    validateResponses(v, { statuses: (s) => s < 500 })(
      fakeReq(),
      res,
      next as unknown as NextFunction,
    );
    res.json({ anything: true }); // would fail 200 schema, but 500 is skipped
    expect(sentJson).toHaveBeenCalledWith({ anything: true });
    expect(erroredWith(next)).toBeUndefined();
  });

  it("validates a JSON string sent via res.send", () => {
    const { res, sentSend } = fakeRes(200, { "content-type": "application/json" });
    const next = vi.fn();
    validateResponses(v)(fakeReq(), res, next as unknown as NextFunction);
    res.send(JSON.stringify({ id: 7 })); // id must be a string
    expect(sentSend).not.toHaveBeenCalled();
    expect(erroredWith(next)).toBeInstanceOf(ResponseValidationError);
  });

  it("passes non-JSON send payloads through untouched", () => {
    const { res, sentSend } = fakeRes(200, { "content-type": "text/html" });
    const next = vi.fn();
    validateResponses(v)(fakeReq(), res, next as unknown as NextFunction);
    res.send("<html>not json</html>");
    expect(sentSend).toHaveBeenCalledWith("<html>not json</html>");
    expect(erroredWith(next)).toBeUndefined();
  });

  it("does not re-validate the error handler's own response (no loop)", () => {
    const { res, sentJson } = fakeRes();
    const next = vi.fn();
    validateResponses(v)(fakeReq(), res, next as unknown as NextFunction);
    res.json({ id: 123 }); // fails -> forwards
    expect(erroredWith(next)).toBeInstanceOf(ResponseValidationError);
    // Simulate the error middleware sending its own (also-invalid) body.
    res.json({ problem: "details" });
    expect(sentJson).toHaveBeenCalledWith({ problem: "details" });
    // Still only one forwarded error.
    expect(next.mock.calls.filter((c) => c[0] instanceof ResponseValidationError)).toHaveLength(1);
  });

  it("invokes a custom onError with the failing leaves and context", () => {
    const onError = vi.fn();
    const { res } = fakeRes();
    const next = vi.fn();
    validateResponses(v, { onError })(fakeReq(), res, next as unknown as NextFunction);
    res.json({ id: 123 });
    expect(onError).toHaveBeenCalledTimes(1);
    const [errors, ctx] = onError.mock.calls[0]!;
    expect(Array.isArray(errors)).toBe(true);
    expect(ctx).toMatchObject({ res, next });
  });

  it("log-and-continue: an onError that returns normally lets the body go out", () => {
    const onError = vi.fn(); // returns undefined -> normal completion
    const { res, sentJson } = fakeRes();
    const next = vi.fn();
    validateResponses(v, { onError })(fakeReq(), res, next as unknown as NextFunction);
    res.json({ id: 123 }); // invalid, but onError doesn't throw
    expect(sentJson).toHaveBeenCalledWith({ id: 123 });
    expect(erroredWith(next)).toBeUndefined();
  });
});
