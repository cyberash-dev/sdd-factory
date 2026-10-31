import { describe, expect, it } from "vitest";
import { URLSearchParams } from "node:url";
import type { Booking, Room } from "../../src/core/index.js";
import { findAvailableRooms } from "../../src/availability/index.js";

const room = (id: string, capacity: number): Room => ({ id, name: `room-${id}`, capacity });
const booking = (id: string, roomId: string, start: string, end: string): Booking => ({
  id,
  roomId,
  title: "meeting",
  start,
  end,
  attendees: 1,
});
const query = (start?: string, end?: string, attendees?: string): URLSearchParams => {
  const params = new URLSearchParams();
  if (start !== undefined) params.set("start", start);
  if (end !== undefined) params.set("end", end);
  if (attendees !== undefined) params.set("attendees", attendees);
  return params;
};

const S = "2026-11-02T09:00:00Z";
const E = "2026-11-02T10:00:00Z";
const typicalRooms = (): Room[] => [room("r1", 4), room("r2", 8), room("r3", 8), room("r4", 2)];
const ids = (result: Room[] | { error: string }): string[] =>
  Array.isArray(result) ? result.map((r) => r.id) : [`ERROR:${result.error}`];

describe("availability: free Rooms ordered by capacity then id", () => {
  // @covers room-booking-api:BEH-019
  it("lists the Rooms with sufficient capacity and no overlapping Booking, capacity ascending then id", () => {
    const bookings = [booking("b1", "r3", S, E)];
    const result = findAvailableRooms(typicalRooms(), bookings, query(S, E, "4"));
    expect(result).toEqual([room("r1", 4), room("r2", 8)]);
  });

  it("keeps a Room whose capacity equals attendees", () => {
    const bookings = [booking("b1", "r3", S, E)];
    const result = findAvailableRooms(
      typicalRooms(),
      bookings,
      query("2026-11-02T11:00:00Z", "2026-11-02T12:00:00Z", "8"),
    );
    expect(ids(result)).toEqual(["r2", "r3"]);
  });

  it("treats a Booking ending exactly at the query start as non-overlapping", () => {
    const bookings = [booking("b1", "r3", "2026-11-02T08:00:00Z", S)];
    expect(ids(findAvailableRooms(typicalRooms(), bookings, query(S, E, "8")))).toEqual(["r2", "r3"]);
  });

  it("treats a Booking starting exactly at the query end as non-overlapping", () => {
    const bookings = [booking("b1", "r3", E, "2026-11-02T11:00:00Z")];
    expect(ids(findAvailableRooms(typicalRooms(), bookings, query(S, E, "8")))).toEqual(["r2", "r3"]);
  });

  it.each([
    ["overlapping the start", "2026-11-02T08:30:00Z", "2026-11-02T09:30:00Z"],
    ["overlapping the end", "2026-11-02T09:30:00Z", "2026-11-02T10:30:00Z"],
    ["inside the interval", "2026-11-02T09:15:00Z", "2026-11-02T09:45:00Z"],
    ["enclosing the interval", "2026-11-02T08:00:00Z", "2026-11-02T11:00:00Z"],
    ["identical to the interval", S, E],
  ])("excludes a Room with a Booking %s", (_label, bs, be) => {
    const bookings = [booking("b1", "r3", bs, be)];
    expect(ids(findAvailableRooms(typicalRooms(), bookings, query(S, E, "8")))).toEqual(["r2"]);
  });

  it("ignores Bookings of other Rooms when judging a Room", () => {
    const bookings = [booking("b1", "r1", S, E)];
    expect(ids(findAvailableRooms(typicalRooms(), bookings, query(S, E, "8")))).toEqual(["r2", "r3"]);
  });

  it("returns an empty list when no Room has sufficient capacity", () => {
    expect(findAvailableRooms(typicalRooms(), [], query(S, E, "100"))).toEqual([]);
  });

  it("orders by capacity first and by numeric room id within equal capacity", () => {
    const rooms = [room("r10", 8), room("r2", 8), room("r7", 3), room("r1", 12), room("r3", 3)];
    expect(ids(findAvailableRooms(rooms, [], query(S, E, "1")))).toEqual(["r3", "r7", "r2", "r10", "r1"]);
  });

  it("rejects a missing attendees parameter with invalid_query", () => {
    expect(findAvailableRooms(typicalRooms(), [], query(S, E))).toEqual({ error: "invalid_query" });
  });
});

describe("availability: rejects missing or invalid parameters", () => {
  const invalid: ReadonlyArray<[string, URLSearchParams]> = [
    ["no parameters", query()],
    ["missing start", query(undefined, E, "2")],
    ["missing end", query(S, undefined, "2")],
    ["missing attendees", query(S, E)],
    ["attendees 0", query(S, E, "0")],
    ["attendees 2.5", query(S, E, "2.5")],
    ["attendees abc", query(S, E, "abc")],
    ["end equal to start", query("2026-11-02T10:00:00Z", E, "2")],
    ["end before start", query(E, S, "2")],
    ["start seconds 30", query("2026-11-02T09:00:30Z", E, "2")],
    ["unparseable end hour 25", query(S, "2026-11-02T25:00:00Z", "2")],
    ["start with offset", query("2026-11-02T11:00:00+02:00", E, "2")],
  ];

  // @covers room-booking-api:BEH-020
  it("answers invalid_query for every missing or invalid parameter and recovers on a valid query", () => {
    expect.assertions(invalid.length * 2);
    for (const [, params] of invalid) {
      expect(findAvailableRooms(typicalRooms(), [], params)).toEqual({ error: "invalid_query" });
      expect(Array.isArray(findAvailableRooms(typicalRooms(), [], query(S, E, "2")))).toBe(true);
    }
  });

  it.each(invalid)("answers invalid_query for %s", (_label, params) => {
    expect(findAvailableRooms(typicalRooms(), [], params)).toEqual({ error: "invalid_query" });
  });

  it("accepts all three parameters valid with end after start", () => {
    expect(ids(findAvailableRooms(typicalRooms(), [], query(S, E, "2")))).toEqual(["r4", "r1", "r2", "r3"]);
  });
});

describe("availability: contract of GET /availability result", () => {
  // @covers room-booking-api:CTR-006
  it("returns every Room, capacity ascending then id, when every Room is free", () => {
    const rooms = [room("r2", 8), room("r1", 4)];
    expect(findAvailableRooms(rooms, [], query(S, E, "4"))).toEqual([room("r1", 4), room("r2", 8)]);
  });

  it("returns an empty list when every Room is booked across the interval", () => {
    const rooms = [room("r1", 4), room("r2", 8)];
    const bookings = [booking("b1", "r1", S, E), booking("b2", "r2", S, E)];
    expect(findAvailableRooms(rooms, bookings, query(S, E, "1"))).toEqual([]);
  });

  it("returns only the Room whose capacity equals attendees when larger ones are booked", () => {
    const rooms = [room("r1", 4), room("r2", 8)];
    expect(findAvailableRooms(rooms, [], query(S, E, "8"))).toEqual([room("r2", 8)]);
  });

  it("answers invalid_query for attendees 0 and never a list", () => {
    const result = findAvailableRooms([room("r1", 4)], [], query(S, E, "0"));
    expect(result).toEqual({ error: "invalid_query" });
  });
});
