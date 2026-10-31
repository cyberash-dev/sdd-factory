import { describe, expect, it } from "vitest";
import {
  JSON_CONTENT_TYPE,
  apiError,
  errorBody,
  errorResponse,
  jsonResponse,
  type ErrorCode,
} from "../../src/errors/index.js";

const PAIRS: ReadonlyArray<readonly [ErrorCode, number]> = [
  ["invalid_json", 400],
  ["invalid_room", 400],
  ["room_name_taken", 409],
  ["invalid_query", 400],
  ["room_not_found", 404],
  ["invalid_booking", 400],
  ["over_capacity", 422],
  ["room_busy", 409],
  ["booking_not_found", 404],
  ["not_found", 404],
  ["method_not_allowed", 405],
];

describe("error code and response envelope", () => {
  // @covers room-booking-api:INV-004
  it("every error response holds an error code of the closed snake_case set, room_busy also holds conflictingBookingId", () => {
    for (const [code, status] of PAIRS) {
      const res = errorResponse(
        code === "room_busy" ? apiError(code, "b1") : apiError(code),
      );
      expect(res.status).toBe(status);
      const body = res.body as { error: string; conflictingBookingId?: string };
      expect(body.error).toBe(code);
      expect(body.error).toMatch(/^[a-z]+(_[a-z]+)*$/);
      if (code === "room_busy") {
        expect(body.conflictingBookingId).toBe("b1");
      } else {
        expect(body.conflictingBookingId).toBeUndefined();
      }
    }
  });

  it.each(PAIRS)("errorResponse maps %s to status %i with body holding only the error code", (code, status) => {
    expect(errorResponse(apiError(code))).toEqual({ status, body: { error: code } });
  });

  it.each(PAIRS)("apiError(%s) carries status %i", (code, status) => {
    expect(apiError(code).code).toBe(code);
    expect(apiError(code).status).toBe(status);
  });

  it("room_busy error response names conflictingBookingId", () => {
    expect(errorResponse(apiError("room_busy", "b1"))).toEqual({
      status: 409,
      body: { error: "room_busy", conflictingBookingId: "b1" },
    });
    expect(errorBody(apiError("room_busy", "b1"))).toEqual({
      error: "room_busy",
      conflictingBookingId: "b1",
    });
  });

  it("conflictingBookingId is emitted only for room_busy", () => {
    expect(errorBody(apiError("invalid_room", "b1"))).toEqual({ error: "invalid_room" });
    expect(errorBody(apiError("over_capacity", "b1"))).toEqual({ error: "over_capacity" });
  });

  // @covers room-booking-api:INV-005
  it("responses with a body use the application/json content type and the 204 carries no body", () => {
    expect(jsonResponse(200, { rooms: [] })).toEqual({ status: 200, body: { rooms: [] } });
    expect(JSON_CONTENT_TYPE).toBe("application/json");
    const empty = jsonResponse(204, undefined);
    expect(empty.status).toBe(204);
    expect(empty.body).toBeUndefined();
  });

  it("an error response is a JSON-serialisable body, not free text", () => {
    const res = errorResponse(apiError("not_found"));
    expect(typeof res.body).toBe("object");
    expect(JSON.parse(JSON.stringify(res.body))).toEqual({ error: "not_found" });
    expect(JSON_CONTENT_TYPE).toBe("application/json");
  });

  // @covers room-booking-api:POL-001
  it("every failure yields a JSON error body with a code of the closed set and no free-text message", () => {
    const closed = PAIRS.map(([c]) => c as string);
    for (const [code] of PAIRS) {
      const body = errorResponse(
        code === "room_busy" ? apiError(code, "b1") : apiError(code),
      ).body as Record<string, unknown>;
      expect(closed).toContain(body.error);
      expect(body.error).not.toMatch(/[A-Z ]/);
      expect(body).not.toHaveProperty("message");
      expect(Object.keys(body).sort()).toEqual(
        code === "room_busy" ? ["conflictingBookingId", "error"] : ["error"],
      );
    }
  });
});
