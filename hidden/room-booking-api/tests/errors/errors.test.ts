import { describe, expect, it } from "vitest";
import { errorBody, failure, isSuccess, statusForCode, success } from "../../src/errors/index.js";
import type { ErrorCode } from "../../src/errors/index.js";

const CATALOGUE: ReadonlyArray<readonly [ErrorCode, number]> = [
  ["invalid_room", 400],
  ["room_name_taken", 409],
  ["invalid_query", 400],
  ["room_not_found", 404],
  ["invalid_booking", 400],
  ["over_capacity", 422],
  ["room_busy", 409],
  ["booking_not_found", 404],
  ["invalid_json", 400],
  ["not_found", 404],
  ["method_not_allowed", 405],
];

describe("error catalogue", () => {
  // @covers room-booking-api:INV-003
  it("error body holds only the snake_case error code for each of the eleven codes", () => {
    expect.assertions(11);
    for (const [code] of CATALOGUE) {
      expect(errorBody(failure(code))).toEqual({ error: code });
    }
  });

  it.each(CATALOGUE)("status for %s is %i", (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });

  // @covers room-booking-api:POL-001
  it("room_busy failure carries conflictingBookingId and no other failure body does", () => {
    expect(errorBody(failure("room_busy", "b1"))).toEqual({ error: "room_busy", conflictingBookingId: "b1" });
    expect(errorBody(failure("invalid_room"))).toEqual({ error: "invalid_room" });
    expect(errorBody(failure("over_capacity"))).toEqual({ error: "over_capacity" });
    expect(Object.keys(errorBody(failure("not_found")))).toEqual(["error"]);
  });

  it("failure result is not ok and keeps its code and conflictingBookingId", () => {
    expect(failure("room_busy", "b2")).toEqual({ ok: false, code: "room_busy", conflictingBookingId: "b2" });
    expect(failure("not_found").ok).toBe(false);
  });

  it("success result keeps status and body and is recognised by isSuccess", () => {
    const ok = success(201, { id: "r1" });
    expect(ok).toEqual({ ok: true, status: 201, body: { id: "r1" } });
    expect(isSuccess(ok)).toBe(true);
    expect(isSuccess(failure("room_not_found"))).toBe(false);
  });
});
