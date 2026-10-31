import { describe, expect, it } from "vitest";
import { URLSearchParams } from "node:url";
import type { ApiError, Booking, Room } from "../../src/core/index.js";
import {
  createBooking,
  createBookingStore,
  deleteBooking,
  listBookings,
  type BookingStore,
} from "../../src/bookings/index.js";

const rooms: Room[] = [
  { id: "r1", name: "Alpha", capacity: 6 },
  { id: "r2", name: "Beta", capacity: 6 },
];

const D = "2026-11-02";

function body(start: string, end: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Standup", start, end, attendees: 4, ...extra };
}

function book(store: BookingStore, roomId: string, start: string, end: string, attendees = 4): Booking {
  return createBooking(store, rooms, roomId, body(start, end, { attendees })) as Booking;
}

function ids(result: Booking[] | ApiError): string[] {
  return (result as Booking[]).map((b) => b.id);
}

function q(s: string): URLSearchParams {
  return new URLSearchParams(s);
}

describe("create booking", () => {
  // @covers room-booking-api:BEH-008
  it("answers the created Booking with a server-assigned id and lists it in the room", () => {
    const store = createBookingStore();
    expect(listBookings(store, rooms, "r1", q(""))).toEqual([]);
    const result = createBooking(store, rooms, "r1", {
      title: "Standup",
      start: `${D}T09:30:00Z`,
      end: `${D}T10:00:00Z`,
      attendees: 4,
    }) as Booking;
    expect(result.id).toMatch(/^b[0-9]+$/);
    expect(result).toEqual({
      id: result.id,
      roomId: "r1",
      title: "Standup",
      start: `${D}T09:30:00Z`,
      end: `${D}T10:00:00Z`,
      attendees: 4,
    });
    const listed = listBookings(store, rooms, "r1", q("")) as Booking[];
    expect(listed.filter((b) => b.id === result.id)).toHaveLength(1);
    expect(listed).toHaveLength(1);
  });

  it("accepts attendees equal to the room capacity and a one-minute interval", () => {
    const store = createBookingStore();
    expect(book(store, "r1", `${D}T11:00:00Z`, `${D}T12:00:00Z`, 6).attendees).toBe(6);
    const one = book(store, "r1", `${D}T13:00:00Z`, `${D}T13:01:00Z`);
    expect(one.start).toBe(`${D}T13:00:00Z`);
    expect(one.end).toBe(`${D}T13:01:00Z`);
  });

  it("answers room_busy when the same request is sent twice", () => {
    const store = createBookingStore();
    const first = book(store, "r1", `${D}T09:30:00Z`, `${D}T10:00:00Z`);
    expect(book(store, "r1", `${D}T09:30:00Z`, `${D}T10:00:00Z`)).toEqual({
      error: "room_busy",
      conflictingBookingId: first.id,
    });
    expect(ids(listBookings(store, rooms, "r1", q("")))).toEqual([first.id]);
  });

  // @covers room-booking-api:BEH-009
  it("answers room_not_found for an unknown Room and stores nothing", () => {
    const store = createBookingStore();
    const valid = body(`${D}T09:00:00Z`, `${D}T10:00:00Z`, { title: "Sync", attendees: 2 });
    expect(createBooking(store, rooms, "r99", valid)).toEqual({ error: "room_not_found" });
    expect(createBooking(store, rooms, "R1", valid)).toEqual({ error: "room_not_found" });
    expect(createBooking(store, rooms, "r99", body(`${D}T09:00:00Z`, `${D}T10:00:00Z`, { title: "" }))).toEqual({
      error: "room_not_found",
    });
    expect(store.bookings).toHaveLength(0);
    expect(listBookings(store, rooms, "r1", q(""))).toEqual([]);
  });

  // @covers room-booking-api:BEH-010
  it("accepts a title of 80 characters and a duration of exactly 8 hours", () => {
    const store = createBookingStore();
    const result = createBooking(store, rooms, "r1", {
      title: "t".repeat(80),
      start: "2026-11-03T08:00:00Z",
      end: "2026-11-03T16:00:00Z",
      attendees: 3,
    }) as Booking;
    expect(result.title).toBe("t".repeat(80));
    expect(result.start).toBe("2026-11-03T08:00:00Z");
    expect(result.end).toBe("2026-11-03T16:00:00Z");
  });

  it.each([
    ["missing title", { start: `${D}T09:00:00Z`, end: `${D}T10:00:00Z`, attendees: 3 }],
    ["empty title", body(`${D}T09:00:00Z`, `${D}T10:00:00Z`, { title: "" })],
    ["whitespace title", body(`${D}T09:00:00Z`, `${D}T10:00:00Z`, { title: "   " })],
    ["81-character title", body(`${D}T09:00:00Z`, `${D}T10:00:00Z`, { title: "t".repeat(81) })],
    ["non-string title", body(`${D}T09:00:00Z`, `${D}T10:00:00Z`, { title: 5 })],
    ["8 hours 1 minute", body("2026-11-04T08:00:00Z", "2026-11-04T16:01:00Z")],
    ["end equal to start", body("2026-11-05T09:00:00Z", "2026-11-05T09:00:00Z")],
    ["end before start", body("2026-11-09T10:00:00Z", "2026-11-09T09:00:00Z")],
    ["start seconds part", body("2026-11-06T09:00:30Z", "2026-11-06T10:00:00Z")],
    ["non-UTC offset", body("2026-11-07T11:00:00+02:00", "2026-11-07T12:00:00Z")],
    ["unparseable date", body("2026-13-45T09:00:00Z", "2026-11-08T10:00:00Z")],
    ["missing end", { title: "Standup", start: `${D}T09:00:00Z`, attendees: 3 }],
  ])("answers invalid_booking for %s and leaves the state unchanged", (_name, payload) => {
    const store = createBookingStore();
    expect(createBooking(store, rooms, "r1", payload)).toEqual({ error: "invalid_booking" });
    expect(store.bookings).toHaveLength(0);
    expect(listBookings(store, rooms, "r1", q(""))).toEqual([]);
  });

  // @covers room-booking-api:BEH-011
  it("answers over_capacity for attendees one above capacity and accepts equal to capacity", () => {
    const store = createBookingStore();
    expect(book(store, "r1", `${D}T11:00:00Z`, `${D}T12:00:00Z`, 6).attendees).toBe(6);
    expect(book(store, "r1", `${D}T13:00:00Z`, `${D}T14:00:00Z`, 7)).toEqual({ error: "over_capacity" });
    expect(listBookings(store, rooms, "r1", q("")) as Booking[]).toHaveLength(1);
  });

  it.each([
    ["attendees 0", 0],
    ["attendees 2.5", 2.5],
    ["attendees as string", "3"],
    ["attendees missing", undefined],
  ])("answers invalid_booking for %s, not over_capacity", (_name, attendees) => {
    const store = createBookingStore();
    const payload: Record<string, unknown> = { title: "Sync", start: `${D}T15:00:00Z`, end: `${D}T16:00:00Z` };
    if (attendees !== undefined) payload.attendees = attendees;
    expect(createBooking(store, rooms, "r1", payload)).toEqual({ error: "invalid_booking" });
    expect(store.bookings).toHaveLength(0);
  });

  // @covers room-booking-api:BEH-012
  it("answers room_busy naming the earliest-starting conflicting booking", () => {
    const store = createBookingStore();
    const b1 = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    book(store, "r1", `${D}T10:00:00Z`, `${D}T11:00:00Z`);
    const result = book(store, "r1", `${D}T09:45:00Z`, `${D}T10:15:00Z`);
    expect(result).toEqual({ error: "room_busy", conflictingBookingId: expect.any(String) });
    expect((result as unknown as ApiError).conflictingBookingId).toBe(b1.id);
    expect(store.bookings).toHaveLength(2);
  });

  it("names the earliest-starting booking when the interval spans two bookings", () => {
    const store = createBookingStore();
    const b1 = book(store, "r1", `${D}T09:00:00Z`, `${D}T09:20:00Z`);
    book(store, "r1", `${D}T09:40:00Z`, `${D}T10:00:00Z`);
    expect(book(store, "r1", `${D}T08:50:00Z`, `${D}T10:10:00Z`)).toEqual({
      error: "room_busy",
      conflictingBookingId: b1.id,
    });
    expect(book(store, "r1", `${D}T09:10:00Z`, `${D}T09:50:00Z`)).toEqual({
      error: "room_busy",
      conflictingBookingId: b1.id,
    });
  });

  it("answers room_busy for an interval fully inside an existing booking", () => {
    const store = createBookingStore();
    const b1 = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    expect(book(store, "r1", `${D}T09:05:00Z`, `${D}T09:10:00Z`)).toEqual({
      error: "room_busy",
      conflictingBookingId: b1.id,
    });
  });

  it("accepts intervals touching an existing booking at its start or end, and the same interval in another room", () => {
    const store = createBookingStore();
    book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    expect(book(store, "r1", `${D}T08:00:00Z`, `${D}T09:00:00Z`).roomId).toBe("r1");
    expect(book(store, "r1", `${D}T10:00:00Z`, `${D}T11:00:00Z`).roomId).toBe("r1");
    expect(book(store, "r2", `${D}T09:00:00Z`, `${D}T10:00:00Z`).roomId).toBe("r2");
  });

  it("checks over_capacity before room_busy", () => {
    const store = createBookingStore();
    book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    expect(book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`, 7)).toEqual({ error: "over_capacity" });
  });
});

describe("list bookings", () => {
  // @covers room-booking-api:BEH-013
  it("orders the Bookings of a room by start and then by numeric booking id, excluding other rooms", () => {
    const store = createBookingStore();
    expect(listBookings(store, rooms, "r1", q(""))).toEqual([]);
    const late = book(store, "r1", `${D}T11:00:00Z`, `${D}T12:00:00Z`);
    const early = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    book(store, "r2", `${D}T08:00:00Z`, `${D}T08:30:00Z`);
    expect(ids(listBookings(store, rooms, "r1", q("")))).toEqual([early.id, late.id]);

    const tied = createBookingStore();
    const mk = (id: string): Booking => ({
      id,
      roomId: "r1",
      title: "Tie",
      start: `${D}T09:00:00Z`,
      end: `${D}T10:00:00Z`,
      attendees: 1,
    });
    tied.bookings.push(mk("b10"), mk("b9"), mk("b2"));
    expect(ids(listBookings(tied, rooms, "r1", q("")))).toEqual(["b2", "b9", "b10"]);
  });

  it("lists ten consecutive bookings in start order with b10 after b9", () => {
    const store = createBookingStore();
    for (let h = 8; h < 18; h++) {
      const hh = String(h).padStart(2, "0");
      const nn = String(h + 1).padStart(2, "0");
      book(store, "r1", `${D}T${hh}:00:00Z`, `${D}T${nn}:00:00Z`);
    }
    expect(ids(listBookings(store, rooms, "r1", q("")))).toEqual([
      "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10",
    ]);
  });

  // @covers room-booking-api:BEH-014
  it("keeps the booking ending at to-boundary and drops the booking starting at to", () => {
    const store = createBookingStore();
    const ending = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    book(store, "r1", `${D}T10:00:00Z`, `${D}T11:00:00Z`);
    expect(ids(listBookings(store, rooms, "r1", q(`from=${D}T09:00:00Z&to=${D}T10:00:00Z`)))).toEqual([ending.id]);
  });

  it.each([
    ["ending exactly at from", "2026-11-03T08:00:00Z", "2026-11-03T09:00:00Z", "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z", 0],
    ["starting exactly at to", "2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z", "2026-11-04T09:00:00Z", "2026-11-04T10:00:00Z", 0],
    ["spanning the whole window", "2026-11-05T08:00:00Z", "2026-11-05T12:00:00Z", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z", 1],
  ])("window filter for a booking %s", (_n, s, e, from, to, count) => {
    const store = createBookingStore();
    book(store, "r1", s, e);
    const result = listBookings(store, rooms, "r1", q(`from=${from}&to=${to}`)) as Booking[];
    expect(result).toHaveLength(count);
  });

  it("answers every booking for a window covering all and for no window", () => {
    const store = createBookingStore();
    book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    book(store, "r1", `${D}T10:00:00Z`, `${D}T11:00:00Z`);
    expect(listBookings(store, rooms, "r1", q(`from=${D}T00:00:00Z&to=2026-11-03T00:00:00Z`)) as Booking[]).toHaveLength(2);
    expect(listBookings(store, rooms, "r1", q("")) as Booking[]).toHaveLength(2);
  });

  // @covers room-booking-api:BEH-015
  it.each([
    ["only from", `from=${D}T09:00:00Z`],
    ["only to", `to=${D}T10:00:00Z`],
    ["to equal to from", `from=${D}T09:00:00Z&to=${D}T09:00:00Z`],
    ["to before from", `from=${D}T10:00:00Z&to=${D}T09:00:00Z`],
    ["unparseable from", `from=not-a-time&to=${D}T10:00:00Z`],
    ["from seconds part", `from=${D}T09:00:30Z&to=${D}T10:00:00Z`],
    ["from with offset", `from=${D}T11:00:00%2B02:00&to=${D}T10:00:00Z`],
  ])("answers invalid_query for %s", (_n, query) => {
    const store = createBookingStore();
    expect(listBookings(store, rooms, "r1", q(query))).toEqual({ error: "invalid_query" });
    expect(listBookings(store, rooms, "r1", q(`from=${D}T09:00:00Z&to=${D}T10:00:00Z`))).toEqual([]);
  });

  // @covers room-booking-api:BEH-016
  it("answers room_not_found for an unknown Room, with or without a window, even with an invalid window", () => {
    const store = createBookingStore();
    expect(listBookings(store, rooms, "r99", q(""))).toEqual({ error: "room_not_found" });
    expect(listBookings(store, rooms, "R99", q(""))).toEqual({ error: "room_not_found" });
    expect(listBookings(store, rooms, "r99", q(`from=${D}T09:00:00Z&to=${D}T10:00:00Z`))).toEqual({
      error: "room_not_found",
    });
    expect(listBookings(store, rooms, "r99", q(`from=${D}T09:00:00Z`))).toEqual({ error: "room_not_found" });
  });
});

describe("delete booking", () => {
  // @covers room-booking-api:BEH-017
  it("frees the interval of a deleted Booking", () => {
    const store = createBookingStore();
    const b1 = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    const b2 = book(store, "r1", `${D}T10:00:00Z`, `${D}T11:00:00Z`);
    expect(deleteBooking(store, b1.id)).toBeNull();
    expect(ids(listBookings(store, rooms, "r1", q("")))).toEqual([b2.id]);
    expect(book(store, "r1", `${D}T09:30:00Z`, `${D}T09:45:00Z`).roomId).toBe("r1");
    expect(deleteBooking(store, b1.id)).toEqual({ error: "booking_not_found" });
  });

  // @covers room-booking-api:BEH-018
  it("answers booking_not_found for an unknown booking id", () => {
    const store = createBookingStore();
    const b1 = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    expect(deleteBooking(store, "b404")).toEqual({ error: "booking_not_found" });
    expect(deleteBooking(store, "B1")).toEqual({ error: "booking_not_found" });
    expect(ids(listBookings(store, rooms, "r1", q("")))).toEqual([b1.id]);
  });
});

describe("booking contracts", () => {
  // @covers room-booking-api:CTR-003
  it("answers only the documented outcomes for create booking", () => {
    const store = createBookingStore();
    const first = createBooking(store, rooms, "r1", body(`${D}T09:00:00Z`, `${D}T10:00:00Z`)) as Booking;
    expect(first).toMatchObject({ roomId: "r1", title: "Standup", attendees: 4 });
    expect(createBooking(store, rooms, "r1", body(`${D}T11:00:00Z`, `${D}T12:00:00Z`, { title: "" }))).toEqual({
      error: "invalid_booking",
    });
    expect(createBooking(store, rooms, "r99", body(`${D}T09:00:00Z`, `${D}T10:00:00Z`))).toEqual({
      error: "room_not_found",
    });
    expect(createBooking(store, rooms, "r1", body(`${D}T09:30:00Z`, `${D}T10:30:00Z`))).toEqual({
      error: "room_busy",
      conflictingBookingId: first.id,
    });
    expect(createBooking(store, rooms, "r1", body(`${D}T13:00:00Z`, `${D}T14:00:00Z`, { attendees: 7 }))).toEqual({
      error: "over_capacity",
    });
    expect(store.bookings).toHaveLength(1);
  });

  // @covers room-booking-api:CTR-004
  it("answers only the documented outcomes for list bookings and applies the half-open window", () => {
    const store = createBookingStore();
    const only = book(store, "r1", `${D}T10:00:00Z`, `${D}T11:00:00Z`);
    expect(ids(listBookings(store, rooms, "r1", q("")))).toEqual([only.id]);
    expect(listBookings(store, rooms, "r1", q(`from=${D}T09:00:00Z&to=${D}T10:00:00Z`))).toEqual([]);
    expect(listBookings(store, rooms, "r1", q(`from=${D}T09:00:00Z`))).toEqual({ error: "invalid_query" });
    expect(listBookings(store, rooms, "r99", q(""))).toEqual({ error: "room_not_found" });
  });

  // @covers room-booking-api:CTR-005
  it("answers null for delete booking and booking_not_found for a deleted or unknown id", () => {
    const store = createBookingStore();
    const b1 = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    expect(deleteBooking(store, b1.id)).toBeNull();
    expect(listBookings(store, rooms, "r1", q(""))).toEqual([]);
    expect(deleteBooking(store, b1.id)).toEqual({ error: "booking_not_found" });
    expect(deleteBooking(store, "b404")).toEqual({ error: "booking_not_found" });
  });
});

describe("bookings of one room never overlap", () => {
  // @covers room-booking-api:INV-002
  it("accepts adjacent intervals and rejects identical, partial and zero-length intervals", () => {
    const store = createBookingStore();
    const a = book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`);
    const b = book(store, "r1", `${D}T10:00:00Z`, `${D}T11:00:00Z`);
    expect(book(store, "r1", `${D}T09:00:00Z`, `${D}T10:00:00Z`)).toEqual({
      error: "room_busy",
      conflictingBookingId: a.id,
    });
    expect(book(store, "r1", `${D}T09:30:00Z`, `${D}T10:30:00Z`)).toEqual({
      error: "room_busy",
      conflictingBookingId: a.id,
    });
    expect(book(store, "r1", `${D}T12:00:00Z`, `${D}T12:00:00Z`)).toEqual({ error: "invalid_booking" });
    const listed = listBookings(store, rooms, "r1", q("")) as Booking[];
    expect(listed.map((x) => x.id)).toEqual([a.id, b.id]);
    for (let i = 1; i < listed.length; i++) {
      expect(listed[i - 1]!.end <= listed[i]!.start).toBe(true);
    }
  });
});
