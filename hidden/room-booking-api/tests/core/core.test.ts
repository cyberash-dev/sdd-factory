import { describe, expect, it } from "vitest";
import {
  LIMITS,
  formatId,
  idNumber,
  isApiError,
  isValidText,
  overlaps,
  parseTime,
  statusOf,
  type ErrorCode,
} from "../../src/core/index.js";

const MIN = 60_000;
const T0930 = Date.UTC(2026, 10, 2, 9, 30);
const T1000 = Date.UTC(2026, 10, 2, 10, 0);

describe("room representation limits", () => {
  // @covers room-booking-api:CTR-007
  it("room name and capacity limits are 40 characters and 1..100", () => {
    expect(LIMITS.roomNameMax).toBe(40);
    expect(LIMITS.capacityMin).toBe(1);
    expect(LIMITS.capacityMax).toBe(100);
    expect(isValidText("a".repeat(40), LIMITS.roomNameMax)).toBe(true);
    expect(isValidText("a".repeat(41), LIMITS.roomNameMax)).toBe(false);
  });

  it.each([[""], ["   "], [6], [null], [undefined]])("refuses room name %j", (v) => {
    expect(isValidText(v, 40)).toBe(false);
  });

  it("counts code points, not UTF-16 units", () => {
    expect(isValidText("😀".repeat(40), 40)).toBe(true);
    expect(isValidText("😀".repeat(41), 40)).toBe(false);
  });
});

describe("booking representation limits", () => {
  // @covers room-booking-api:CTR-008
  it("booking title limit is 80 characters and start and end are whole-minute times", () => {
    expect(LIMITS.bookingTitleMax).toBe(80);
    expect(LIMITS.bookingMaxMinutes).toBe(480);
    expect(isValidText("t".repeat(80), LIMITS.bookingTitleMax)).toBe(true);
    expect(isValidText("t".repeat(81), LIMITS.bookingTitleMax)).toBe(false);
    expect(parseTime("2026-11-03T09:30:00Z")).toBe(Date.UTC(2026, 10, 3, 9, 30));
    expect(parseTime("2026-11-03T10:00:00Z")).toBe(Date.UTC(2026, 10, 3, 10, 0));
  });
});

describe("time format", () => {
  // @covers room-booking-api:CTR-009
  it("accepts a whole-minute UTC time and returns epoch milliseconds", () => {
    expect(parseTime("2026-11-02T09:30:00Z")).toBe(T0930);
    expect(parseTime("2026-11-02T10:00:00Z")).toBe(T1000);
  });

  it.each([
    ["2026-11-02T11:00:30Z"],
    ["2026-11-02T11:00:00+02:00"],
    ["2026-02-30T09:00:00Z"],
    ["2026-11-02T09:30:00.500Z"],
    ["2026-11-02T09:30:00"],
    ["2026-11-02T25:00:00Z"],
    ["not a time"],
    [""],
    [1793611800000],
    [null],
    [undefined],
    [{}],
  ])("refuses time %j with null", (v) => {
    expect(parseTime(v)).toBeNull();
  });

  it("reads intervals as half-open", () => {
    expect(overlaps(T0930, T1000, T1000, T1000 + 30 * MIN)).toBe(false);
    expect(overlaps(T1000, T1000 + 30 * MIN, T0930, T1000)).toBe(false);
    expect(overlaps(T0930, T1000 + MIN, T1000, T1000 + 30 * MIN)).toBe(true);
    expect(overlaps(T0930, T1000, T0930, T1000)).toBe(true);
  });
});

describe("error response envelope status mapping", () => {
  // @covers room-booking-api:CTR-010
  it.each<[ErrorCode, number]>([
    ["invalid_json", 400],
    ["invalid_query", 400],
    ["invalid_room", 400],
    ["invalid_booking", 400],
    ["not_found", 404],
    ["room_not_found", 404],
    ["booking_not_found", 404],
    ["method_not_allowed", 405],
    ["room_name_taken", 409],
    ["room_busy", 409],
    ["over_capacity", 422],
  ])("maps %s to %i", (code, status) => {
    expect(statusOf(code)).toBe(status);
  });
});

describe("identifiers", () => {
  // @covers room-booking-api:INV-001
  it("formats room and booking ids in creation order and parses them back", () => {
    expect(formatId("room", 1)).toBe("r1");
    expect(formatId("room", 2)).toBe("r2");
    expect(formatId("room", 10)).toBe("r10");
    expect(formatId("booking", 1)).toBe("b1");
    expect(formatId("booking", 2)).toBe("b2");
    expect(idNumber("r1")).toBe(1);
    expect(idNumber("r10")).toBe(10);
    expect(idNumber("b2")).toBe(2);
    expect(idNumber("b123")).toBe(123);
  });
});

describe("stable error code", () => {
  // @covers room-booking-api:INV-003
  it("accepts a snake_case code body and refuses prose and bare strings", () => {
    expect(isApiError({ error: "invalid_query" })).toBe(true);
    expect(isApiError({ error: "booking_not_found" })).toBe(true);
    expect(isApiError({ error: "room_name_taken" })).toBe(true);
    expect(isApiError({ error: "over_capacity" })).toBe(true);
    expect(isApiError({ error: "The query is invalid." })).toBe(false);
    expect(isApiError({ error: "invalid query" })).toBe(false);
    expect(isApiError({ error: "unknown_code" })).toBe(false);
    expect(isApiError("invalid_query")).toBe(false);
    expect(isApiError({})).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});

describe("error reporting policy", () => {
  // @covers room-booking-api:POL-001
  it("carries conflictingBookingId only for room_busy", () => {
    expect(isApiError({ error: "room_busy", conflictingBookingId: "b1" })).toBe(true);
    expect(isApiError({ error: "room_busy" })).toBe(false);
    expect(isApiError({ error: "invalid_room", conflictingBookingId: "b1" })).toBe(false);
    expect(isApiError({ error: "not_found" })).toBe(true);
    expect(isApiError({ error: "invalid_room" })).toBe(true);
    expect(isApiError({ error: "Room is busy" })).toBe(false);
  });
});
