import { describe, it, expect, vi } from "vitest";
import type { Booking } from "../../../src/state/index.js";

async function load() {
  vi.resetModules();
  const state = await import("../../../src/state/index.js");
  const write = await import("../../../src/bookings/write/index.js");
  return { state, write };
}

type Ctx = Awaited<ReturnType<typeof load>>;

const D = "2026-11-02T";
const at = (hm: string) => `${D}${hm}:00Z`;

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Standup", start: at("09:00"), end: at("09:30"), attendees: 2, ...over };
}

function without(field: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const b = body(over);
  delete b[field];
  return b;
}

function book(c: Ctx, roomId: string, from: string, to: string, attendees = 2, title = "Standup") {
  return c.write.createBooking(roomId, { title, start: at(from), end: at(to), attendees });
}

function idsOf(c: Ctx, roomId: string): string[] {
  return c.state.listBookingsOfRoom(roomId).map((b) => b.id);
}

const err = (status: number, error: string) => ({ status, body: { error } });
const busy = (id: string) => ({ status: 409, body: { error: "room_busy", conflictingBookingId: id } });

describe("booking creation: accepted booking", () => {
  // @covers room-booking-api:CTR-003
  it("answers a canonical booking with exactly id, roomId, title, start, end and attendees", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", {
      title: "Standup",
      start: "2026-11-02T09:30:00Z",
      end: "2026-11-02T10:00:00Z",
      attendees: 5,
    });
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:30:00Z",
        end: "2026-11-02T10:00:00Z",
        attendees: 5,
      },
    });
  });

  // @covers room-booking-api:BEH-007
  it("stores the first booking under the room of the path and lists it only there", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    c.state.addRoom("Borealis", 8);
    const r = c.write.createBooking("r1", {
      title: "Standup",
      start: "2026-11-02T09:30:00Z",
      end: "2026-11-02T10:00:00Z",
      attendees: 5,
    });
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:30:00Z",
        end: "2026-11-02T10:00:00Z",
        attendees: 5,
      },
    });
    expect(idsOf(c, "r1")).toEqual(["b1"]);
    expect(idsOf(c, "r2")).toEqual([]);
  });

  it("assigns b1, b2, b3 to successive bookings of one room", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const ids = [book(c, "r1", "09:00", "09:30"), book(c, "r1", "10:00", "10:30"), book(c, "r1", "11:00", "11:30")].map(
      (r) => (r as { booking: Booking }).booking.id,
    );
    expect(ids).toEqual(["b1", "b2", "b3"]);
  });

  it("accepts a booking with the exact room capacity", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", {
      title: "Full",
      start: "2026-11-02T11:00:00Z",
      end: "2026-11-02T12:00:00Z",
      attendees: 8,
    });
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Full",
        start: "2026-11-02T11:00:00Z",
        end: "2026-11-02T12:00:00Z",
        attendees: 8,
      },
    });
  });

  it("accepts a booking of one minute", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", {
      title: "Short",
      start: "2026-11-02T13:00:00Z",
      end: "2026-11-02T13:01:00Z",
      attendees: 1,
    });
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Short",
        start: "2026-11-02T13:00:00Z",
        end: "2026-11-02T13:01:00Z",
        attendees: 1,
      },
    });
  });

  it("ignores a body field that is not part of a booking and never echoes it", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", body({ extra: "x", id: "b77", roomId: "r9" }));
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:00:00Z",
        end: "2026-11-02T09:30:00Z",
        attendees: 2,
      },
    });
  });
});

describe("booking creation: time spelling echo", () => {
  // @covers room-booking-api:BEH-026
  it("accepts the short spelling and reports start and end exactly as the request gave them", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", {
      title: "Standup",
      start: "2026-11-02T09:30Z",
      end: "2026-11-02T10:00:00Z",
      attendees: 2,
    });
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:30Z",
        end: "2026-11-02T10:00:00Z",
        attendees: 2,
      },
    });
    const listed = c.state.listBookingsOfRoom("r1");
    expect(listed.map((b) => [b.start, b.end])).toEqual([["2026-11-02T09:30Z", "2026-11-02T10:00:00Z"]]);
  });

  it.each([
    ["short spelling", "2026-11-02T11:00Z", "2026-11-02T12:00:00Z"],
    ["zero fractional seconds", "2026-11-02T09:31:00.000Z", "2026-11-02T10:00:00Z"],
    ["zero fractional seconds on end", "2026-11-02T13:00:00.000Z", "2026-11-02T13:30:00.000Z"],
    ["canonical spelling", "2026-11-02T11:00:00Z", "2026-11-02T12:00:00Z"],
  ])("keeps start and end character for character: %s", async (_name, start, end) => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", body({ start, end }));
    expect(r).toStrictEqual({
      booking: { id: "b1", roomId: "r1", title: "Standup", start, end, attendees: 2 },
    });
    expect(c.state.listBookingsOfRoom("r1").map((b) => [b.start, b.end])).toEqual([[start, end]]);
  });

  it("rejects a start with non-zero seconds as invalid_booking and stores nothing", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", body({ start: "2026-11-02T09:30:30Z", end: at("10:00") }));
    expect(r).toStrictEqual(err(400, "invalid_booking"));
    expect(idsOf(c, "r1")).toEqual([]);
  });

  it("rejects a booking without a start as invalid_booking", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", without("start", { end: at("10:00") }));
    expect(r).toStrictEqual(err(400, "invalid_booking"));
    expect(idsOf(c, "r1")).toEqual([]);
  });
});

describe("booking creation: unknown room", () => {
  // @covers room-booking-api:BEH-008
  it("answers room_not_found for an unknown room even when the title is empty", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r99", body({ title: "" }));
    expect(r).toStrictEqual(err(404, "room_not_found"));
    expect(idsOf(c, "r1")).toEqual([]);
  });

  it.each(["r99", "roomA"])("answers room_not_found for the id %s with a valid body and creates nothing", async (id) => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking(id, body({ attendees: 5 }));
    expect(r).toStrictEqual(err(404, "room_not_found"));
    expect(idsOf(c, "r1")).toEqual([]);
  });

  it.each([
    ["end before start", { start: at("10:00"), end: at("09:00") }],
    ["attendees 0", { attendees: 0 }],
    ["attendees above any capacity", { attendees: 500 }],
  ])("answers room_not_found, not a field error, for an unknown room with %s", async (_n, over) => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    expect(c.write.createBooking("r99", body(over))).toStrictEqual(err(404, "room_not_found"));
  });

  it("creates the booking when the room exists", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", body({ attendees: 5 }));
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:00:00Z",
        end: "2026-11-02T09:30:00Z",
        attendees: 5,
      },
    });
    expect(idsOf(c, "r1")).toEqual(["b1"]);
  });
});

describe("booking creation: invalid booking", () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ["empty title", body({ title: "" })],
    ["81-character title", body({ title: "T".repeat(81) })],
    ["absent title", without("title")],
    ["numeric title", body({ title: 5 })],
    ["start with 30 seconds", body({ start: "2026-11-02T09:00:30Z" })],
    ["start with a non-zero fraction", body({ start: "2026-11-02T09:00:00.500Z" })],
    ["start with an explicit offset", body({ start: "2026-11-02T09:00:00+01:00" })],
    ["start without the Z suffix", body({ start: "2026-11-02T09:00:00" })],
    ["start that is not a time", body({ start: "tomorrow" })],
    ["start that is a number", body({ start: 1793610000000 })],
    ["month 13", body({ start: "2026-13-02T09:00:00Z" })],
    ["absent end", without("end")],
    ["equal start and end", body({ start: at("09:00"), end: at("09:00") })],
    ["end before start", body({ start: at("10:00"), end: at("09:00") })],
    ["duration of 8 hours and one minute", body({ start: at("08:00"), end: at("16:01") })],
    ["attendees 0", body({ attendees: 0 })],
    ["attendees -1", body({ attendees: -1 })],
    ["attendees 2.5", body({ attendees: 2.5 })],
    ["absent attendees", without("attendees")],
    ["attendees as the string 5", body({ attendees: "5" })],
  ];

  // @covers room-booking-api:BEH-009
  it("answers invalid_booking for every invalid title, time or duration and keeps the room empty", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    for (const [name, b] of invalid) {
      expect(c.write.createBooking("r1", b), name).toStrictEqual(err(400, "invalid_booking"));
    }
    expect(idsOf(c, "r1")).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a string", "Standup"],
    ["a number", 42],
    ["true", true],
  ])("answers invalid_booking for a body that is valid JSON but %s", async (_n, b) => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    expect(c.write.createBooking("r1", b)).toStrictEqual(err(400, "invalid_booking"));
  });

  it("answers invalid_booking, not over_capacity, for attendees 0", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    expect(c.write.createBooking("r1", body({ attendees: 0 }))).toStrictEqual(err(400, "invalid_booking"));
  });

  it("answers invalid_booking, not over_capacity, for a malformed booking above the capacity", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    expect(c.write.createBooking("r1", body({ attendees: 9, title: "" }))).toStrictEqual(err(400, "invalid_booking"));
  });

  it("accepts a booking of exactly 8 hours", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", {
      title: "Long",
      start: "2026-11-02T08:00:00Z",
      end: "2026-11-02T16:00:00Z",
      attendees: 2,
    });
    expect(r).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Long",
        start: "2026-11-02T08:00:00Z",
        end: "2026-11-02T16:00:00Z",
        attendees: 2,
      },
    });
  });

  it("accepts and echoes a title of exactly 80 characters", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const title = "T".repeat(80);
    const r = c.write.createBooking("r1", body({ title, start: at("08:00"), end: at("09:00") }));
    expect(r).toStrictEqual({
      booking: { id: "b1", roomId: "r1", title, start: at("08:00"), end: at("09:00"), attendees: 2 },
    });
  });
});

describe("booking creation: capacity", () => {
  // @covers room-booking-api:BEH-010
  it("answers over_capacity for attendees 9 in a room of capacity 8 and stores nothing", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    const r = c.write.createBooking("r1", body({ title: "Over", attendees: 9 }));
    expect(r).toStrictEqual(err(422, "over_capacity"));
    expect(idsOf(c, "r1")).toEqual([]);
  });

  it("answers over_capacity for attendees 2 in a room of capacity 1", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    c.state.addRoom("Closet", 1);
    expect(c.write.createBooking("r2", body({ attendees: 2 }))).toStrictEqual(err(422, "over_capacity"));
    expect(idsOf(c, "r2")).toEqual([]);
  });

  it.each([
    ["attendees 8 in a room of capacity 8", 8, 8],
    ["attendees 9 in a room of capacity 9", 9, 9],
    ["attendees 5 in a room of capacity 5", 5, 5],
    ["attendees 1 in a room of capacity 1", 1, 1],
  ])("accepts %s", async (_n, capacity, attendees) => {
    const c = await load();
    c.state.addRoom("Aurora", capacity);
    const r = c.write.createBooking("r1", body({ title: "Full", attendees }));
    expect(r).toStrictEqual({
      booking: { id: "b1", roomId: "r1", title: "Full", start: at("09:00"), end: at("09:30"), attendees },
    });
  });
});

describe("booking creation: overlap", () => {
  async function threeBookings(): Promise<Ctx> {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    c.state.addRoom("Borealis", 8);
    book(c, "r1", "09:00", "09:15");
    book(c, "r1", "09:15", "09:30");
    book(c, "r1", "09:30", "10:00");
    return c;
  }

  // @covers room-booking-api:BEH-011
  it("answers room_busy naming b1 for an interval partly overlapping b1 and stores nothing", async () => {
    const c = await threeBookings();
    expect(idsOf(c, "r1")).toEqual(["b1", "b2", "b3"]);
    expect(book(c, "r1", "09:10", "09:20")).toStrictEqual(busy("b1"));
    expect(idsOf(c, "r1")).toEqual(["b1", "b2", "b3"]);
  });

  it("names the earliest-starting booking when the interval overlaps two adjacent bookings", async () => {
    const c = await threeBookings();
    expect(book(c, "r1", "09:10", "09:40")).toStrictEqual(busy("b1"));
  });

  it("names b2 for an interval reaching back to the start of b2", async () => {
    const c = await threeBookings();
    expect(book(c, "r1", "09:15", "09:30")).toStrictEqual(busy("b2"));
    expect(idsOf(c, "r1")).toEqual(["b1", "b2", "b3"]);
  });

  it("accepts an interval touching the end of b3", async () => {
    const c = await threeBookings();
    const r = book(c, "r1", "10:00", "11:30");
    expect(r).toStrictEqual({
      booking: { id: "b4", roomId: "r1", title: "Standup", start: at("10:00"), end: at("11:30"), attendees: 2 },
    });
    expect(idsOf(c, "r1")).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("accepts the same interval on another room with no bookings", async () => {
    const c = await threeBookings();
    const r = book(c, "r2", "09:10", "09:20");
    expect(r).toStrictEqual({
      booking: { id: "b4", roomId: "r2", title: "Standup", start: at("09:10"), end: at("09:20"), attendees: 2 },
    });
    expect(idsOf(c, "r1")).toEqual(["b1", "b2", "b3"]);
  });

  it("answers room_busy with both error and conflictingBookingId for a contained and a covering interval", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    expect(book(c, "r1", "09:30", "11:00")).toStrictEqual(busy("b1"));
    expect(book(c, "r1", "09:10", "09:20")).toStrictEqual(busy("b1"));
    expect(book(c, "r1", "08:00", "12:00")).toStrictEqual(busy("b1"));
  });

  it("decides over_capacity before room_busy", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    expect(book(c, "r1", "09:30", "10:30", 9)).toStrictEqual(err(422, "over_capacity"));
  });
});

describe("booking creation: touching intervals", () => {
  // @covers room-booking-api:BEH-012
  it("accepts a booking starting exactly when b1 ends and lists both bookings", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    const r = book(c, "r1", "10:00", "10:30");
    expect(r).toStrictEqual({
      booking: { id: "b2", roomId: "r1", title: "Standup", start: at("10:00"), end: at("10:30"), attendees: 2 },
    });
    expect(idsOf(c, "r1")).toEqual(["b1", "b2"]);
  });

  it("accepts a booking ending exactly when b1 starts", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    const r = book(c, "r1", "08:30", "09:00");
    expect(r).toStrictEqual({
      booking: { id: "b2", roomId: "r1", title: "Standup", start: at("08:30"), end: at("09:00"), attendees: 2 },
    });
  });

  it("answers room_busy naming b1 for one minute of overlap", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    expect(book(c, "r1", "09:59", "10:30")).toStrictEqual(busy("b1"));
    expect(idsOf(c, "r1")).toEqual(["b1"]);
  });

  it("accepts a chain of touching bookings and lists three in start order", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    book(c, "r1", "10:00", "10:30");
    const r = book(c, "r1", "10:30", "11:00");
    expect(r).toStrictEqual({
      booking: { id: "b3", roomId: "r1", title: "Standup", start: at("10:30"), end: at("11:00"), attendees: 2 },
    });
    expect(idsOf(c, "r1")).toEqual(["b1", "b2", "b3"]);
  });
});

describe("booking deletion", () => {
  // @covers room-booking-api:BEH-017
  it("deletes b1, empties the room list and accepts the freed interval again", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    expect(c.write.deleteBooking("b1")).toStrictEqual({ deleted: true });
    expect(c.state.listBookingsOfRoom("r1")).toEqual([]);
    const r = book(c, "r1", "09:00", "10:00");
    expect(r).toStrictEqual({
      booking: { id: "b2", roomId: "r1", title: "Standup", start: at("09:00"), end: at("10:00"), attendees: 2 },
    });
  });

  it("accepts a shifted interval over the freed one after the delete", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    c.write.deleteBooking("b1");
    const r = book(c, "r1", "09:30", "10:30");
    expect(r).toStrictEqual({
      booking: { id: "b2", roomId: "r1", title: "Standup", start: at("09:30"), end: at("10:30"), attendees: 2 },
    });
  });

  it("answers booking_not_found for a second delete of the same id", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    expect(c.write.deleteBooking("b1")).toStrictEqual({ deleted: true });
    expect(c.write.deleteBooking("b1")).toStrictEqual(err(404, "booking_not_found"));
  });

  // @covers room-booking-api:BEH-018
  it("answers booking_not_found for a booking id that never existed", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    expect(c.write.deleteBooking("b99")).toStrictEqual(err(404, "booking_not_found"));
    expect(idsOf(c, "r1")).toEqual(["b1"]);
  });

  // @covers room-booking-api:CTR-005
  it("answers a delete with { deleted: true } once, booking_not_found afterwards, and removes only the named booking", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    book(c, "r1", "10:00", "11:00");
    expect(c.write.deleteBooking("b1")).toStrictEqual({ deleted: true });
    expect(c.write.deleteBooking("b1")).toStrictEqual(err(404, "booking_not_found"));
    expect(c.write.deleteBooking("b99")).toStrictEqual(err(404, "booking_not_found"));
    expect(idsOf(c, "r1")).toEqual(["b2"]);
    expect(c.write.deleteBooking("b2")).toStrictEqual({ deleted: true });
  });
});

describe("booking scenarios", () => {
  // @covers room-booking-api:SCN-001
  it("books a room, rejects an overlap, deletes the booking and books the freed interval", async () => {
    const c = await load();
    const room = c.state.addRoom("Aurora", 8);
    expect(room.id).toBe("r1");
    const first = c.write.createBooking("r1", {
      title: "Standup",
      start: "2026-11-02T09:00:00Z",
      end: "2026-11-02T10:00:00Z",
      attendees: 5,
    });
    expect(first).toStrictEqual({
      booking: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:00:00Z",
        end: "2026-11-02T10:00:00Z",
        attendees: 5,
      },
    });
    const review = { title: "Review", start: "2026-11-02T09:30:00Z", end: "2026-11-02T10:30:00Z", attendees: 5 };
    expect(c.write.createBooking("r1", review)).toStrictEqual(busy("b1"));
    expect(c.write.createBooking("r1", review)).toStrictEqual(busy("b1"));
    expect(c.write.deleteBooking("b1")).toStrictEqual({ deleted: true });
    expect(c.state.listBookingsOfRoom("r1")).toEqual([]);
    expect(c.write.createBooking("r1", review)).toStrictEqual({
      booking: {
        id: "b2",
        roomId: "r1",
        title: "Review",
        start: "2026-11-02T09:30:00Z",
        end: "2026-11-02T10:30:00Z",
        attendees: 5,
      },
    });
  });

  // @covers room-booking-api:SCN-002
  it("assigns booking ids in creation order across rooms and never reuses a deleted id", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    c.state.addRoom("Borealis", 8);
    const id = (r: unknown) => (r as { booking: Booking }).booking.id;
    expect(id(book(c, "r1", "09:00", "10:00"))).toBe("b1");
    expect(id(book(c, "r2", "09:00", "10:00"))).toBe("b2");
    expect(id(book(c, "r1", "10:00", "11:00"))).toBe("b3");
    expect(c.write.deleteBooking("b1")).toStrictEqual({ deleted: true });
    expect(id(book(c, "r2", "10:00", "11:00"))).toBe("b4");
  });

  it("gives the first booking on r2 the id b1 and consumes no id for a rejected create", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    c.state.addRoom("Borealis", 8);
    expect(book(c, "r1", "09:00", "10:00", 9)).toStrictEqual(err(422, "over_capacity"));
    const r = book(c, "r2", "09:00", "10:00");
    expect(r).toStrictEqual({
      booking: { id: "b1", roomId: "r2", title: "Standup", start: at("09:00"), end: at("10:00"), attendees: 2 },
    });
  });

  // @covers room-booking-api:SCN-003
  it("names the earliest-starting conflicting booking b2 and leaves the room unchanged", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "10:00", "11:00");
    book(c, "r1", "09:00", "09:30");
    book(c, "r1", "09:30", "10:00");
    expect(book(c, "r1", "09:15", "10:30")).toStrictEqual(busy("b2"));
    expect(idsOf(c, "r1")).toEqual(["b2", "b3", "b1"]);
  });

  it("names b1 when it is the only conflicting booking", async () => {
    const c = await load();
    c.state.addRoom("Aurora", 8);
    book(c, "r1", "09:00", "10:00");
    expect(book(c, "r1", "09:15", "09:45")).toStrictEqual(busy("b1"));
  });
});
