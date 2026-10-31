import { describe, expect, it } from "vitest";
import { apiError, isApiError, roomBusyError, statusFor } from "../../src/errors/index.js";
import type { ErrorCode } from "../../src/errors/index.js";

const PLAIN_CODES: ReadonlyArray<readonly [ErrorCode, number]> = [
  ["invalid_json", 400],
  ["not_found", 404],
  ["method_not_allowed", 405],
  ["invalid_room", 400],
  ["room_name_taken", 409],
  ["invalid_query", 400],
  ["room_not_found", 404],
  ["invalid_booking", 400],
  ["over_capacity", 422],
  ["booking_not_found", 404],
];

const ALL_CODES: ReadonlyArray<readonly [ErrorCode, number]> = [...PLAIN_CODES, ["room_busy", 409]];

describe("error envelope", () => {
  // @covers room-booking-api:POL-001
  it("answers each stable error code with its status and a body holding only the code", () => {
    expect.assertions(PLAIN_CODES.length);
    for (const [code, status] of PLAIN_CODES) {
      expect(apiError(code)).toEqual({ status, body: { error: code } });
    }
  });

  it("answers a room_busy conflict with status 409 and the conflictingBookingId", () => {
    expect(roomBusyError("b1")).toEqual({
      status: 409,
      body: { error: "room_busy", conflictingBookingId: "b1" },
    });
  });

  it("maps every error code to its status in the single status table", () => {
    expect.assertions(ALL_CODES.length);
    for (const [code, status] of ALL_CODES) {
      expect(statusFor(code)).toBe(status);
    }
  });

  it("answers the same invalid input class with the same code on every repetition", () => {
    const first = apiError("invalid_room");
    const second = apiError("invalid_room");
    expect(first).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(second).toEqual({ status: 400, body: { error: "invalid_room" } });
  });

  it("never reports a prose sentence in the error field", () => {
    expect.assertions(PLAIN_CODES.length * 2);
    for (const [code] of PLAIN_CODES) {
      const body = apiError(code).body;
      expect(body.error).toBe(code);
      expect(body.error).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  // @covers room-booking-api:INV-003
  it("carries conflictingBookingId in a room_busy body and in no other error body", () => {
    expect(roomBusyError("b1").body.conflictingBookingId).toBe("b1");
    expect.assertions(1 + PLAIN_CODES.length * 2);
    for (const [code] of PLAIN_CODES) {
      const body = apiError(code).body;
      expect("conflictingBookingId" in body).toBe(false);
      expect(Object.keys(body)).toEqual(["error"]);
    }
  });

  it("copies the given booking id into the room_busy body", () => {
    expect(roomBusyError("b-42").body).toEqual({
      error: "room_busy",
      conflictingBookingId: "b-42",
    });
  });

  it("recognises envelopes built for a plain code and for room_busy", () => {
    expect(isApiError({ status: 404, body: { error: "not_found" } })).toBe(true);
    expect(
      isApiError({ status: 409, body: { error: "room_busy", conflictingBookingId: "b1" } }),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not_found"],
    ["a number", 404],
    ["an empty object", {}],
    ["no body", { status: 400 }],
    ["an empty body", { status: 400, body: {} }],
    ["a prose error", { status: 400, body: { error: "invalid request" } }],
    ["an unknown code", { status: 400, body: { error: "teapot" } }],
    ["room_busy without conflictingBookingId", { status: 409, body: { error: "room_busy" } }],
    [
      "conflictingBookingId on a non-busy code",
      { status: 404, body: { error: "not_found", conflictingBookingId: "b1" } },
    ],
  ])("rejects %s as an API error", (_label, value) => {
    expect(isApiError(value)).toBe(false);
  });

  // @covers room-booking-api:INV-004
  it("yields only JSON-serialisable bodies with a 4xx status and never the bodiless 204", () => {
    const all = [...ALL_CODES.map(([code]) => (code === "room_busy" ? roomBusyError("b1") : apiError(code)))];
    expect.assertions(all.length * 3);
    for (const e of all) {
      expect(JSON.parse(JSON.stringify(e.body))).toEqual(e.body);
      expect(e.status).not.toBe(204);
      expect(e.status).toBeGreaterThanOrEqual(400);
    }
  });
});
