import { describe, expect, it } from "vitest";
import { addBooking, addRoom, createStore } from "../../src/domain/index.js";
import type { Store } from "../../src/domain/index.js";
import { listAvailability, listBookings } from "../../src/booking-reads/index.js";

const q = (s = "") => new URLSearchParams(s);
const T = (hm: string) => `2026-11-02T${hm}:00Z`;

function book(store: Store, roomId: string, start: string, end: string, attendees = 1) {
  return addBooking(store, roomId, { title: "Sync", start: T(start), end: T(end), attendees });
}

function bookingIds(res: ReturnType<typeof listBookings>): string[] {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}`);
  return res.value.bookings.map((b) => b.id);
}

function roomIds(res: ReturnType<typeof listAvailability>): string[] {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}`);
  return res.value.rooms.map((r) => r.id);
}

function oneRoomStore(): Store {
  const store = createStore();
  addRoom(store, "Aurora", 10);
  return store;
}

function availabilityStore(): Store {
  const store = createStore();
  addRoom(store, "Aurora", 4);
  addRoom(store, "Borealis", 10);
  addRoom(store, "Cirrus", 10);
  addRoom(store, "Delta", 8);
  book(store, "r2", "10:00", "11:00");
  return store;
}

const AV = (start: string, end: string, attendees: string) => `start=${T(start)}&end=${T(end)}&attendees=${attendees}`;

describe("GET /rooms/:roomId/bookings listBookings ordering", () => {
  // @covers room-booking-api:BEH-012
  it("a Room without a window lists its Bookings ordered by start then id", () => {
    const store = oneRoomStore();
    const b1 = book(store, "r1", "10:00", "11:00");
    const b2 = book(store, "r1", "09:00", "09:30");
    const b3 = book(store, "r1", "10:00", "10:30");
    const res = listBookings(store, "r1", q());
    expect(res).toEqual({ ok: true, value: { bookings: [b2, b1, b3] } });
    expect(bookingIds(res)).toEqual(["b2", "b1", "b3"]);
  });

  it("a Room without Bookings answers an empty bookings envelope", () => {
    expect(listBookings(oneRoomStore(), "r1", q())).toEqual({ ok: true, value: { bookings: [] } });
  });

  it("Bookings with equal start are ordered by numeric id, so b10 follows b9", () => {
    const store = oneRoomStore();
    for (let i = 0; i < 10; i++) book(store, "r1", "10:00", "11:00");
    expect(bookingIds(listBookings(store, "r1", q()))).toEqual([
      "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10",
    ]);
  });

  it("Bookings of another Room do not appear in the list", () => {
    const store = oneRoomStore();
    addRoom(store, "Borealis", 10);
    book(store, "r2", "08:00", "09:00");
    book(store, "r1", "10:00", "11:00");
    book(store, "r2", "12:00", "13:00");
    expect(bookingIds(listBookings(store, "r1", q()))).toEqual(["b2"]);
  });

  it("an unknown Room answers room_not_found, not an empty list", () => {
    expect(listBookings(oneRoomStore(), "r99", q())).toEqual({ ok: false, error: { code: "room_not_found" } });
  });
});

describe("GET /rooms/:roomId/bookings listBookings window", () => {
  // @covers room-booking-api:BEH-013
  it("a from/to window lists exactly the Bookings overlapping the half-open interval", () => {
    const store = oneRoomStore();
    book(store, "r1", "10:00", "11:00");
    const res = listBookings(store, "r1", q(`from=${T("10:30")}&to=${T("11:30")}`));
    expect(res).toEqual({
      ok: true,
      value: {
        bookings: [{ id: "b1", roomId: "r1", title: "Sync", start: T("10:00"), end: T("11:00"), attendees: 1 }],
      },
    });
  });

  it.each([
    ["window fully inside the Booking", "10:00", "10:30", ["b1"]],
    ["window ending exactly at the Booking start", "09:00", "10:00", []],
    ["window starting exactly at the Booking end", "11:00", "12:00", []],
    ["window covering the whole Booking", "09:00", "12:00", ["b1"]],
  ])("%s", (_name, from, to, ids) => {
    const store = oneRoomStore();
    book(store, "r1", "10:00", "11:00");
    expect(bookingIds(listBookings(store, "r1", q(`from=${T(from)}&to=${T(to)}`)))).toEqual(ids);
  });

  it("a window omits the non-overlapping Bookings and keeps start then id order", () => {
    const store = oneRoomStore();
    book(store, "r1", "10:00", "11:00");
    book(store, "r1", "09:00", "09:30");
    book(store, "r1", "10:00", "10:30");
    book(store, "r1", "13:00", "14:00");
    expect(bookingIds(listBookings(store, "r1", q(`from=${T("09:15")}&to=${T("10:15")}`)))).toEqual(["b2", "b1", "b3"]);
  });

  it("only from answers invalid_query, not an unfiltered list", () => {
    const store = oneRoomStore();
    book(store, "r1", "10:00", "11:00");
    expect(listBookings(store, "r1", q(`from=${T("10:00")}`))).toEqual({ ok: false, error: { code: "invalid_query" } });
  });

  it("an unknown Room with a valid window answers room_not_found, not 200", () => {
    expect(listBookings(oneRoomStore(), "r99", q(`from=${T("10:00")}&to=${T("12:00")}`))).toEqual({
      ok: false,
      error: { code: "room_not_found" },
    });
  });
});

describe("GET /rooms/:roomId/bookings listBookings invalid window", () => {
  // @covers room-booking-api:BEH-014
  it.each([
    ["only from", `from=${T("10:00")}`],
    ["only to", `to=${T("12:00")}`],
    ["to before from", `from=${T("11:00")}&to=${T("10:00")}`],
    ["to equal to from", `from=${T("11:00")}&to=${T("11:00")}`],
    ["unparsable times", "from=yesterday&to=today"],
    ["time without Z", `from=${T("10:00")}&to=2026-11-02T12:00:00`],
    ["time with an offset", `from=${T("10:00")}&to=2026-11-02T12:00:00%2B00:00`],
  ])("%s answers invalid_query", (_name, query) => {
    const store = oneRoomStore();
    book(store, "r1", "10:00", "11:00");
    expect(listBookings(store, "r1", q(query))).toEqual({ ok: false, error: { code: "invalid_query" } });
  });

  it("a complete valid window answers a bookings array", () => {
    const res = listBookings(oneRoomStore(), "r1", q(`from=${T("10:00")}&to=${T("12:00")}`));
    expect(res).toEqual({ ok: true, value: { bookings: [] } });
  });

  it("an unknown Room answers room_not_found with no query", () => {
    expect(listBookings(oneRoomStore(), "r99", q())).toEqual({ ok: false, error: { code: "room_not_found" } });
  });

  it("the Room is checked before the window, so an unknown Room with a bad window is room_not_found", () => {
    expect(listBookings(oneRoomStore(), "r99", q(`from=${T("10:00")}`))).toEqual({
      ok: false,
      error: { code: "room_not_found" },
    });
  });
});

describe("GET /availability listAvailability", () => {
  // @covers room-booking-api:BEH-017
  it("lists free Rooms with enough capacity ordered by capacity then id", () => {
    const res = listAvailability(availabilityStore(), q(AV("10:30", "11:30", "6")));
    expect(res).toEqual({
      ok: true,
      value: {
        rooms: [
          { id: "r4", name: "Delta", capacity: 8 },
          { id: "r3", name: "Cirrus", capacity: 10 },
        ],
      },
    });
  });

  it("a Room is available again outside its Booking and the order stays by capacity then id", () => {
    expect(roomIds(listAvailability(availabilityStore(), q(AV("12:00", "13:00", "6"))))).toEqual(["r4", "r2", "r3"]);
  });

  it("a Room whose capacity equals attendees is listed", () => {
    expect(roomIds(listAvailability(availabilityStore(), q(AV("12:00", "13:00", "4"))))).toEqual([
      "r1", "r4", "r2", "r3",
    ]);
  });

  it("attendees above every capacity answers an empty rooms array, not invalid_query", () => {
    expect(listAvailability(availabilityStore(), q(AV("12:00", "13:00", "11")))).toEqual({
      ok: true,
      value: { rooms: [] },
    });
  });

  it.each([
    ["window ending exactly at the Booking start", "09:00", "10:00"],
    ["window starting exactly at the Booking end", "11:00", "12:00"],
  ])("a Booking touching only the %s does not make the Room busy", (_name, start, end) => {
    expect(roomIds(listAvailability(availabilityStore(), q(AV(start, end, "6"))))).toEqual(["r4", "r2", "r3"]);
  });

  it("equal capacities are ordered by numeric id, so r10 follows r9", () => {
    const store = createStore();
    for (let i = 1; i <= 10; i++) addRoom(store, `Room ${i}`, 5);
    expect(roomIds(listAvailability(store, q(AV("10:00", "11:00", "2"))))).toEqual([
      "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10",
    ]);
  });

  it("a server without Rooms answers an empty rooms array", () => {
    expect(listAvailability(createStore(), q(AV("13:00", "14:00", "11")))).toEqual({
      ok: true,
      value: { rooms: [] },
    });
  });

  it("attendees equal to zero answers invalid_query, not every free Room", () => {
    expect(listAvailability(availabilityStore(), q(AV("12:00", "13:00", "0")))).toEqual({
      ok: false,
      error: { code: "invalid_query" },
    });
  });
});

describe("GET /availability listAvailability invalid parameters", () => {
  // @covers room-booking-api:BEH-018
  it.each([
    ["no query at all", ""],
    ["attendees missing", `start=${T("10:00")}&end=${T("11:00")}`],
    ["start missing", `end=${T("11:00")}&attendees=2`],
    ["end missing", `start=${T("10:00")}&attendees=2`],
    ["end equal to start", AV("10:00", "10:00", "2")],
    ["end before start", AV("11:00", "10:00", "2")],
    ["end without Z", `start=${T("10:00")}&end=2026-11-02T10:00:00&attendees=2`],
    ["start unparsable", `start=yesterday&end=${T("11:00")}&attendees=2`],
    ["attendees zero", AV("10:00", "11:00", "0")],
    ["attendees fractional", AV("10:00", "11:00", "2.5")],
    ["attendees negative", AV("10:00", "11:00", "-1")],
    ["attendees not a number", AV("10:00", "11:00", "many")],
    ["attendees empty", AV("10:00", "11:00", "")],
  ])("%s answers invalid_query", (_name, query) => {
    expect(listAvailability(availabilityStore(), q(query))).toEqual({ ok: false, error: { code: "invalid_query" } });
  });

  it("a complete valid query answers a rooms array", () => {
    const res = listAvailability(availabilityStore(), q(AV("10:00", "11:00", "2")));
    expect(res).toEqual({
      ok: true,
      value: {
        rooms: [
          { id: "r1", name: "Aurora", capacity: 4 },
          { id: "r4", name: "Delta", capacity: 8 },
          { id: "r3", name: "Cirrus", capacity: 10 },
        ],
      },
    });
  });
});

describe("room-booking-api contracts of the read endpoints", () => {
  // @covers room-booking-api:CTR-005
  it("the bookings envelope is ordered by start then id, filtered by the half-open window and rejects a lone from", () => {
    const store = oneRoomStore();
    book(store, "r1", "10:00", "11:00");
    book(store, "r1", "09:00", "09:30");
    expect(bookingIds(listBookings(store, "r1", q()))).toEqual(["b2", "b1"]);
    expect(bookingIds(listBookings(store, "r1", q(`from=${T("09:00")}&to=${T("10:00")}`)))).toEqual(["b2"]);
    expect(listBookings(store, "r1", q(`from=${T("09:00")}`))).toEqual({ ok: false, error: { code: "invalid_query" } });
    expect(listBookings(store, "r99", q())).toEqual({ ok: false, error: { code: "room_not_found" } });
  });

  // @covers room-booking-api:CTR-007
  it("the rooms envelope lists free Rooms by capacity then id and rejects a missing parameter", () => {
    const store = availabilityStore();
    expect(roomIds(listAvailability(store, q(AV("10:30", "11:30", "6"))))).toEqual(["r4", "r3"]);
    expect(listAvailability(store, q(`start=${T("10:00")}&end=${T("11:00")}`))).toEqual({
      ok: false,
      error: { code: "invalid_query" },
    });
    expect(listAvailability(store, q(AV("11:00", "11:00", "2")))).toEqual({
      ok: false,
      error: { code: "invalid_query" },
    });
  });
});
