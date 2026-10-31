import { describe, it, expect } from "vitest";
import { createStore, parseTime, formatError } from "../../src/core/index.js";
import type { Booking, ErrorCode, Store } from "../../src/core/index.js";

const T0900 = 1793610000000;
const T0930 = 1793611800000;
const T1000 = 1793613600000;
const T1030 = 1793615400000;
const T1100 = 1793617200000;

function book(
  store: Store,
  roomId: string,
  startMs: number,
  endMs: number,
  extra: { title?: string; attendees?: number } = {},
): Booking {
  return store.addBooking({
    roomId,
    title: extra.title ?? "Standup",
    start: new Date(startMs).toISOString().replace(".000Z", "Z"),
    end: new Date(endMs).toISOString().replace(".000Z", "Z"),
    startMs,
    endMs,
    attendees: extra.attendees ?? 5,
  });
}

describe("Time parsing (BEH-011, BEH-012)", () => {
  // @covers room-booking-api:BEH-011
  it("parseTime rejects absent, non-string, unparseable, date-only and offset times", () => {
    const rejected: unknown[] = [
      undefined,
      null,
      1729,
      {},
      "tomorrow",
      "2026-11-02",
      "2026-11-02T09:00:00+02:00",
      "2026-11-02T09:00:00",
      "",
    ];
    for (const value of rejected) {
      expect(parseTime(value), String(value)).toBeUndefined();
    }
  });

  it("parseTime returns the epoch milliseconds of a UTC Z-suffixed whole minute", () => {
    expect(parseTime("2026-11-02T09:00:00Z")).toBe(T0900);
    expect(parseTime("2026-11-02T10:00:00Z")).toBe(T1000);
  });

  // @covers room-booking-api:BEH-012
  it("parseTime rejects a non-zero seconds or fractional-second part", () => {
    expect(parseTime("2026-11-02T09:00:30Z")).toBeUndefined();
    expect(parseTime("2026-11-02T09:00:00.500Z")).toBeUndefined();
    expect(parseTime("2026-11-02T09:00:00.001Z")).toBeUndefined();
  });

  it("parseTime accepts a zero fraction and a seconds-less writing as the same whole minute", () => {
    expect(parseTime("2026-11-02T09:00:00.000Z")).toBe(T0900);
    expect(parseTime("2026-11-02T09:30Z")).toBe(T0930);
    expect(parseTime("2026-11-02T09:30:00Z")).toBe(T0930);
  });

  it("a Booking keeps the submitted start and end text and exposes its instants", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    const stored = store.addBooking({
      roomId: "r1",
      title: "Standup",
      start: "2026-11-02T09:30Z",
      end: "2026-11-02T10:30Z",
      startMs: T0930,
      endMs: T1030,
      attendees: 5,
    });
    expect(stored.start).toBe("2026-11-02T09:30Z");
    expect(stored.end).toBe("2026-11-02T10:30Z");
    expect(store.instantOf(stored)).toEqual({ startMs: T0930, endMs: T1030 });
  });
});

describe("Room ids (INV-001)", () => {
  // @covers room-booking-api:INV-001
  it("the k-th created Room carries the id r<k>, first and tenth", () => {
    const store = createStore();
    expect(store.addRoom({ name: "Room 1", capacity: 4 }).id).toBe("r1");
    expect(store.addRoom({ name: "Room 2", capacity: 4 }).id).toBe("r2");
    for (let k = 3; k <= 9; k++) store.addRoom({ name: `Room ${k}`, capacity: 4 });
    expect(store.addRoom({ name: "Room 10", capacity: 4 }).id).toBe("r10");
  });

  it("rooms() lists r1, r2 and r3 and findRoom resolves each id", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 4 });
    store.addRoom({ name: "Borealis", capacity: 10 });
    store.addRoom({ name: "Cirrus", capacity: 6 });
    expect(store.rooms().map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(store.findRoom("r2")?.name).toBe("Borealis");
    expect(store.findRoom("r4")).toBeUndefined();
  });

  it("roomNameTaken reports a created name and no other", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 4 });
    expect(store.roomNameTaken("Aurora")).toBe(true);
    expect(store.roomNameTaken("Borealis")).toBe(false);
  });
});

describe("Booking ids (INV-002)", () => {
  // @covers room-booking-api:INV-002
  it("booking ids count across all Rooms and a deleted id is never reused", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    store.addRoom({ name: "Borealis", capacity: 10 });
    expect(book(store, "r1", T0900, T1000).id).toBe("b1");
    expect(book(store, "r2", T0900, T1000).id).toBe("b2");
    expect(store.removeBooking("b1")).toBe(true);
    expect(store.findBooking("b1")).toBeUndefined();
    expect(book(store, "r1", T0900, T1000).id).toBe("b3");
  });

  it("removeBooking answers false for an unknown id", () => {
    const store = createStore();
    expect(store.removeBooking("b9")).toBe(false);
  });

  it("the first Booking of a fresh Store is b1", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    expect(book(store, "r1", T0900, T1000).id).toBe("b1");
  });
});

describe("Overlap (INV-003)", () => {
  // @covers room-booking-api:INV-003
  it("earliestConflict returns the Booking that a partially overlapping interval meets", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    book(store, "r1", T0900, T1000);
    expect(store.earliestConflict("r1", T0930, T1030)?.id).toBe("b1");
    expect(store.bookingsOverlapping("r1", T0930, T1030).map((b) => b.id)).toEqual(["b1"]);
  });

  it("an identical interval conflicts with the stored Booking", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    book(store, "r1", T0900, T1000);
    expect(store.earliestConflict("r1", T0900, T1000)?.id).toBe("b1");
  });

  it("adjacent intervals are not an Overlap in either direction", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    book(store, "r1", T0900, T1000);
    expect(store.earliestConflict("r1", T1000, T1100)).toBeUndefined();
    expect(store.bookingsOverlapping("r1", T1000, T1100)).toEqual([]);
    expect(store.earliestConflict("r1", T0900 - 3600000, T0900)).toBeUndefined();
  });

  it("Bookings of different Rooms never conflict", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    store.addRoom({ name: "Borealis", capacity: 10 });
    book(store, "r1", T0900, T1000);
    expect(store.earliestConflict("r2", T0900, T1000)).toBeUndefined();
  });

  it("a deleted Booking no longer conflicts", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    book(store, "r1", T0900, T1000);
    store.removeBooking("b1");
    expect(store.earliestConflict("r1", T0900, T1000)).toBeUndefined();
  });
});

describe("Response body members (INV-005)", () => {
  // @covers room-booking-api:INV-005
  it("a Room carries exactly id, name and capacity", () => {
    const store = createStore();
    const input = { name: "Aurora", capacity: 10, floor: 3 } as { name: string; capacity: number };
    const room = store.addRoom(input);
    expect(Object.keys(room).sort()).toEqual(["capacity", "id", "name"]);
    expect(Object.keys(store.rooms()[0]!).sort()).toEqual(["capacity", "id", "name"]);
  });

  it("a Booking carries exactly id, roomId, title, start, end and attendees", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    const input = {
      roomId: "r1",
      title: "Standup",
      start: "2026-11-02T09:00:00Z",
      end: "2026-11-02T10:00:00Z",
      startMs: T0900,
      endMs: T1000,
      attendees: 5,
      notes: "x",
    };
    const stored = store.addBooking(input);
    const keys = ["attendees", "end", "id", "roomId", "start", "title"];
    expect(Object.keys(stored).sort()).toEqual(keys);
    expect(Object.keys(store.bookingsOf("r1")[0]!).sort()).toEqual(keys);
    expect(Object.keys(store.findBooking("b1")!).sort()).toEqual(keys);
  });

  it("the room_busy body carries exactly error and conflictingBookingId, other errors only error", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    const held = book(store, "r1", T0900, T1000);
    expect(Object.keys(formatError("room_busy", held).body).sort()).toEqual(["conflictingBookingId", "error"]);
    expect(Object.keys(formatError("invalid_room").body)).toEqual(["error"]);
    expect(Object.keys(formatError("not_found").body)).toEqual(["error"]);
  });
});

describe("Store lifetime (INV-006)", () => {
  // @covers room-booking-api:INV-006
  it("a fresh Store is empty and assigns r1 and b1 again, independent of an earlier Store", () => {
    const first = createStore();
    first.addRoom({ name: "Aurora", capacity: 10 });
    book(first, "r1", T0900, T1000);

    const second = createStore();
    expect(second.rooms()).toEqual([]);
    expect(second.findRoom("r1")).toBeUndefined();
    expect(second.findBooking("b1")).toBeUndefined();
    expect(second.addRoom({ name: "Aurora", capacity: 10 }).id).toBe("r1");
    expect(book(second, "r1", T0900, T1000).id).toBe("b1");
  });
});

describe("Listing order (INV-007)", () => {
  // @covers room-booking-api:INV-007
  it("bookingsOf orders by start then by id", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    book(store, "r1", T1100, T1100 + 3600000);
    book(store, "r1", T0900, T1000);
    book(store, "r1", T1100 + 3600000, T1100 + 7200000);
    expect(store.bookingsOf("r1").map((b) => b.id)).toEqual(["b2", "b1", "b3"]);
  });

  it("bookingsOf breaks equal starts by ascending id", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    book(store, "r1", T1100, T1100 + 3600000);
    book(store, "r1", T0900, T1000);
    book(store, "r1", T0900, T0930);
    expect(store.bookingsOf("r1").map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
  });

  it("bookingsOf of a Room without Bookings is empty", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    expect(store.bookingsOf("r1")).toEqual([]);
  });

  it("availableRooms orders by capacity ascending then by id", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    store.addRoom({ name: "Borealis", capacity: 4 });
    store.addRoom({ name: "Cirrus", capacity: 10 });
    expect(store.availableRooms(T0900, T1000, 1).map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
  });

  it("availableRooms drops busy Rooms and Rooms smaller than the attendees", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    store.addRoom({ name: "Borealis", capacity: 4 });
    store.addRoom({ name: "Cirrus", capacity: 10 });
    book(store, "r1", T0930, T1030);
    expect(store.availableRooms(T0900, T1000, 5).map((r) => r.id)).toEqual(["r3"]);
    expect(store.availableRooms(T1030, T1100, 10).map((r) => r.id)).toEqual(["r1", "r3"]);
  });
});

describe("Error codes (POL-001)", () => {
  const table: Array<[ErrorCode, number]> = [
    ["invalid_json", 400],
    ["invalid_room", 400],
    ["room_name_taken", 409],
    ["invalid_query", 400],
    ["room_not_found", 404],
    ["invalid_booking", 400],
    ["over_capacity", 422],
    ["booking_not_found", 404],
    ["not_found", 404],
    ["method_not_allowed", 405],
  ];

  // @covers room-booking-api:POL-001
  it("formatError maps every code without a conflict to its status and a body holding only the code", () => {
    for (const [code, status] of table) {
      expect(formatError(code), code).toEqual({ status, body: { error: code } });
    }
  });

  it("formatError maps room_busy to 409 with the conflicting Booking id", () => {
    const store = createStore();
    store.addRoom({ name: "Aurora", capacity: 10 });
    const held = book(store, "r1", T0900, T1000);
    expect(formatError("room_busy", held)).toEqual({
      status: 409,
      body: { error: "room_busy", conflictingBookingId: "b1" },
    });
  });
});
