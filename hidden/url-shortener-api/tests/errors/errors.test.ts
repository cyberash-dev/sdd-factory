import { describe, expect, it } from "vitest";
import { ERROR_STATUS, errorResponse, exitStatus, jsonResponse } from "../../src/errors/index.js";
import type { ErrorCode } from "../../src/errors/index.js";

const HTTP_CODES: [ErrorCode, number][] = [
  ["invalid_url", 400],
  ["invalid_json", 400],
  ["not_found", 404],
];

describe("error reporting through stable codes", () => {
  // @covers url-shortener-api:POL-001
  it("error body holds exactly the field error with a listed code and no success body carries error", () => {
    for (const [code] of HTTP_CODES) {
      const res = errorResponse(code);
      expect(JSON.parse(res.body ?? "")).toEqual({ error: code });
    }
    const ok = jsonResponse(201, { code: "Zq9x2B", url: "https://example.com/pol" });
    expect(JSON.parse(ok.body ?? "")).not.toHaveProperty("error");
    expect(ok.status).toBe(201);
  });

  it.each(HTTP_CODES)("error response for %s maps to status %i", (code, status) => {
    expect(errorResponse(code).status).toBe(status);
    expect(ERROR_STATUS[code]).toBe(status);
  });

  it("invalid_port maps to process exit status 1", () => {
    expect(exitStatus("invalid_port")).toBe(1);
  });
});

describe("error responses are JSON with a single stable code field", () => {
  // @covers url-shortener-api:INV-003
  it.each(HTTP_CODES)("error response for %s parses as JSON with exactly the key error", (code) => {
    const res = errorResponse(code);
    const parsed = JSON.parse(res.body ?? "") as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["error"]);
    expect(parsed.error).toBe(code);
    expect(String(parsed.error)).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("error body is the literal single-field JSON", () => {
    expect(errorResponse("not_found").body).toBe('{"error":"not_found"}');
    expect(errorResponse("invalid_url").body).toBe('{"error":"invalid_url"}');
  });
});

describe("JSON responses carry the JSON content type", () => {
  // @covers url-shortener-api:INV-004
  it("201 and 200 JSON responses carry content-type application/json", () => {
    const created = jsonResponse(201, { code: "abc" });
    const fetched = jsonResponse(200, { code: "abc" });
    expect(created.headers["content-type"]).toContain("application/json");
    expect(fetched.headers["content-type"]).toContain("application/json");
    expect(created.status).toBe(201);
    expect(fetched.status).toBe(200);
    expect(JSON.parse(created.body ?? "")).toEqual({ code: "abc" });
  });

  it.each(HTTP_CODES)("error response for %s carries content-type application/json", (code) => {
    expect(errorResponse(code).headers["content-type"]).toContain("application/json");
  });
});
