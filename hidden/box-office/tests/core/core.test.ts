import { describe, expect, it } from "vitest";
import { ApiError, isInteger, isPlainObject, parseTime, toIsoString } from "../../src/core/index.js";
import type { ErrorCode } from "../../src/core/index.js";

const MAPPING: ReadonlyArray<readonly [ErrorCode, number]> = [
  ["E_MALFORMED_JSON", 400],
  ["E_INVALID_INPUT", 400],
  ["E_INVALID_QUERY", 400],
  ["E_INVALID_TIER", 400],
  ["E_UNAUTHENTICATED", 401],
  ["E_FORBIDDEN", 403],
  ["E_NOT_FOUND", 404],
  ["E_EMAIL_TAKEN", 409],
  ["E_EVENT_CANCELLED", 409],
  ["E_EVENT_NOT_ON_SALE", 409],
  ["E_TICKETS_UNAVAILABLE", 409],
  ["E_TICKETS_AVAILABLE", 409],
  ["E_ALREADY_WAITING", 409],
  ["E_CODE_TAKEN", 409],
  ["E_ORDER_STATE", 409],
  ["E_TICKET_LIMIT", 422],
  ["E_DISCOUNT_UNUSABLE", 422],
];

describe("error vocabulary", () => {
  // @covers box-office:POL-001
  it("every error code answers a status in 400, 401, 403, 404, 409, 422 and never a 2xx or 500", () => {
    expect(MAPPING).toHaveLength(17);
    for (const [code] of MAPPING) {
      const err = new ApiError(code, "any message");
      expect([400, 401, 403, 404, 409, 422]).toContain(err.status);
      expect(err.code).toBe(code);
    }
  });

  // @covers box-office:INV-008
  it("the 400, 404 and 422 failure classes carry their stated status and their error code", () => {
    const bad = new ApiError("E_INVALID_INPUT", "password too short");
    const missing = new ApiError("E_NOT_FOUND", "no such event");
    const limit = new ApiError("E_TICKET_LIMIT", "seventh ticket");
    expect(bad.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(limit.status).toBe(422);
    for (const e of [bad, missing, limit]) {
      expect(e).toBeInstanceOf(Error);
      expect(e.code.length).toBeGreaterThan(0);
    }
  });

  it.each(MAPPING)("%s maps to status %i", (code, status) => {
    const err = new ApiError(code, "detail");
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });
});

describe("boundary validation helpers", () => {
  // @covers box-office:POL-002
  it("a non-object JSON body, a missing field and a wrong value type are rejected as values, not thrown", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("text")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject({ email: "c@example.com" })).toBe(true);
    expect(isPlainObject({})).toBe(true);
    expect(isInteger("two")).toBe(false);
    expect(isInteger(undefined)).toBe(false);
    expect(isInteger(null)).toBe(false);
    expect(isInteger(2)).toBe(true);
  });

  it.each([
    [1.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    ["7", false],
    [0, true],
    [-3, true],
  ])("isInteger(%s) is %s", (value, expected) => {
    expect(isInteger(value)).toBe(expected);
  });

  it("E_MALFORMED_JSON and E_INVALID_INPUT both answer 400", () => {
    expect(new ApiError("E_MALFORMED_JSON", "bad json").status).toBe(400);
    expect(new ApiError("E_INVALID_INPUT", "bad type").status).toBe(400);
  });
});

describe("request times and response times", () => {
  // @covers box-office:INV-004
  it("a short form and an offset form are parsed to the same instant and rendered with milliseconds and Z", () => {
    const short = parseTime("2027-11-02T18:00:00Z");
    const offset = parseTime("2027-11-02T20:00:00+02:00");
    expect(short).toBe(1825178400000);
    expect(offset).toBe(1825178400000);
    expect(toIsoString(1825178400000)).toBe("2027-11-02T18:00:00.000Z");
    expect(toIsoString(short as number)).toBe("2027-11-02T18:00:00.000Z");
    expect(toIsoString(offset as number)).toBe("2027-11-02T18:00:00.000Z");
  });

  it("the millisecond form parses to the same instant as the short form", () => {
    expect(parseTime("2026-11-02T18:00:00.000Z")).toBe(parseTime("2026-11-02T18:00:00Z"));
  });

  it("toIsoString of the epoch is 1970-01-01T00:00:00.000Z", () => {
    expect(toIsoString(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it.each([["not a time"], [""], [12345], [null], [undefined], [{}]])(
    "parseTime(%j) is undefined",
    (value) => {
      expect(parseTime(value)).toBeUndefined();
    },
  );
});
