import { describe, expect, it } from "vitest";
import { errorBody, fail, ok, statusFor } from "../../src/errors/index.js";
import type { ErrorCode } from "../../src/errors/index.js";

describe("error vocabulary", () => {
  // @covers room-booking-api:POL-001
  it("error body holds a snake_case error code first and conflictingBookingId second for room_busy", () => {
    const plain = errorBody({ code: "invalid_room" });
    expect(plain).toEqual({ error: "invalid_room" });
    const busy = errorBody({ code: "room_busy", conflictingBookingId: "b1" });
    expect(busy).toEqual({ error: "room_busy", conflictingBookingId: "b1" });
    expect(Object.keys(busy)).toEqual(["error", "conflictingBookingId"]);
  });

  it.each<[ErrorCode, number]>([
    ["invalid_json", 400],
    ["invalid_room", 400],
    ["invalid_query", 400],
    ["invalid_booking", 400],
    ["not_found", 404],
    ["room_not_found", 404],
    ["booking_not_found", 404],
    ["method_not_allowed", 405],
    ["room_name_taken", 409],
    ["room_busy", 409],
    ["over_capacity", 422],
  ])("status of %s is %i", (code, status) => {
    expect(statusFor(code)).toBe(status);
  });

  it.each<ErrorCode>(["not_found", "method_not_allowed", "invalid_json", "over_capacity"])(
    "error body of %s carries only the error field",
    (code) => {
      expect(errorBody({ code })).toEqual({ error: code });
    },
  );

  it("Result helpers wrap a value and an error", () => {
    expect(ok(5)).toEqual({ ok: true, value: 5 });
    expect(fail({ code: "not_found" })).toEqual({ ok: false, error: { code: "not_found" } });
  });
});
