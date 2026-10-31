import { describe, expect, it } from "vitest";
import { findAvailableRooms } from "../../src/availability/index.js";
import type { Booking, Room, Store } from "../../src/store/index.js";

// In-memory Store double: keeps the suite independent of M-02's implementation.
function makeStore(roomSpecs: Array<[string, number]>): Store {
  const rooms: Room[] = roomSpecs.map(([id, capacity]) => ({ id, name: `Room ${id}`, capacity }));
  const bookings: Booking[] = [];
  let counter = 0;
  return {
    rooms: {
      create: () => {
        throw new Error("unused");
      },
      get: (id) => rooms.find((r) => r.id === id),
      list: () => rooms,
      findByNameIgnoringCase: () => undefined,
    },
    bookings: {
      create: (input) => {
        counter += 1;
        const booking: Booking = { id: `b${counter}`, ...input };
        bookings.push(booking);
        return booking;
      },
      get: (id) => bookings.find((b) => b.id === id),
      listByRoom: (roomId) => bookings.filter((b) => b.roomId === roomId),
      remove: () => false,
    },
  };
}

function book(store: Store, roomId: string, start: string, end: string): void {
  store.bookings.create({ roomId, title: "Standup", start, end, attendees: 2 });
}

function threeRooms(): Store {
  return makeStore([
    ["r1", 4],
    ["r2", 12],
    ["r3", 8],
  ]);
}

function withR3Booking(): Store {
  const store = threeRooms();
  book(store, "r3", "2026-11-02T09:00:00Z", "2026-11-02T10:00:00Z");
  return store;
}

function q(start: string | null, end: string | null, attendees: string | null): URLSearchParams {
  const p = new URLSearchParams();
  if (start !== null) p.set("start", start);
  if (end !== null) p.set("end", end);
  if (attendees !== null) p.set("attendees", attendees);
  return p;
}

function listedIds(result: unknown): string[] {
  const r = result as { ok: boolean; status: number; body: { rooms: Array<{ id: string }> } };
  expect(r.ok).toBe(true);
  expect(r.status).toBe(200);
  return r.body.rooms.map((room) => room.id);
}

const S0900 = "2026-11-02T09:00:00Z";
const S0930 = "2026-11-02T09:30:00Z";
const S1000 = "2026-11-02T10:00:00Z";
const S1030 = "2026-11-02T10:30:00Z";
const S1100 = "2026-11-02T11:00:00Z";

describe("availability: rooms free for the requested interval", () => {
  // @covers room-booking-api:BEH-016
  it("lists only r2 when r1 is too small and r3 holds an overlapping booking", () => {
    const result = findAvailableRooms(withR3Booking(), q(S0930, S1030, "5"));
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [{ id: "r2", name: "Room r2", capacity: 12 }] },
    });
  });

  it("keeps a room whose capacity equals attendees", () => {
    expect(listedIds(findAvailableRooms(withR3Booking(), q(S1000, S1100, "8")))).toEqual(["r3", "r2"]);
  });

  it("lists r3 when its booking ends exactly at the requested start", () => {
    expect(listedIds(findAvailableRooms(withR3Booking(), q(S1000, S1100, "5")))).toEqual(["r3", "r2"]);
  });

  it("lists r3 when its booking starts exactly at the requested end", () => {
    const store = threeRooms();
    book(store, "r3", S1000, S1100);
    expect(listedIds(findAvailableRooms(store, q(S0900, S1000, "5")))).toEqual(["r3", "r2"]);
  });

  it("returns 200 with an empty rooms array when no room is large enough", () => {
    expect(findAvailableRooms(withR3Booking(), q(S0930, S1030, "13"))).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [] },
    });
  });

  it("returns 200 with an empty rooms array on a store without rooms", () => {
    expect(findAvailableRooms(makeStore([]), q(S0930, S1030, "1"))).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [] },
    });
  });

  it("orders rooms by capacity ascending, not by id", () => {
    expect(listedIds(findAvailableRooms(withR3Booking(), q("2026-11-02T08:00:00Z", S0900, "4")))).toEqual([
      "r1",
      "r3",
      "r2",
    ]);
  });

  it("breaks capacity ties by numeric id", () => {
    const store = makeStore([
      ["r10", 6],
      ["r2", 6],
      ["r3", 5],
    ]);
    expect(listedIds(findAvailableRooms(store, q(S0900, S1000, "1")))).toEqual(["r3", "r2", "r10"]);
  });

  it("omits a room whose booking fully contains the requested interval", () => {
    const store = threeRooms();
    book(store, "r2", "2026-11-02T08:00:00Z", S1100);
    expect(listedIds(findAvailableRooms(store, q(S0930, S1000, "5")))).toEqual(["r3"]);
  });

  it("accepts an interval longer than 8 hours", () => {
    expect(listedIds(findAvailableRooms(threeRooms(), q(S0900, "2026-11-04T09:00:00Z", "5")))).toEqual(["r3", "r2"]);
  });

  it("rejects missing attendees with invalid_query and lists no rooms", () => {
    expect(findAvailableRooms(withR3Booking(), q(S0930, S1030, null))).toEqual({
      ok: false,
      code: "invalid_query",
    });
  });
});

describe("availability: complete valid query", () => {
  // @covers room-booking-api:BEH-017
  it("answers 200 with a rooms array for start 09:00Z, end 10:00Z and attendees 1", () => {
    const result = findAvailableRooms(threeRooms(), q(S0900, S1000, "1"));
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        rooms: [
          { id: "r1", name: "Room r1", capacity: 4 },
          { id: "r3", name: "Room r3", capacity: 8 },
          { id: "r2", name: "Room r2", capacity: 12 },
        ],
      },
    });
  });

  const invalid: Array<[string, () => URLSearchParams]> = [
    ["no parameters", () => q(null, null, null)],
    ["missing start", () => q(null, S1000, "1")],
    ["missing end", () => q(S0900, null, "1")],
    ["missing attendees", () => q(S0900, S1000, null)],
    ["attendees 0", () => q(S0900, S1000, "0")],
    ["negative attendees", () => q(S0900, S1000, "-1")],
    ["non-numeric attendees", () => q(S0900, S1000, "abc")],
    ["fractional attendees", () => q(S0900, S1000, "1.5")],
    ["empty attendees", () => q(S0900, S1000, "")],
    ["reversed interval", () => q(S1000, S0900, "1")],
    ["empty interval", () => q(S0900, S0900, "1")],
    ["unparseable start", () => q("not-a-time", S1000, "1")],
    ["unparseable end", () => q(S0900, "not-a-time", "1")],
    ["start with a UTC offset", () => q("2026-11-02T09:00:00+01:00", S1000, "1")],
    ["start with non-zero seconds", () => q("2026-11-02T09:00:30Z", S1000, "1")],
    [
      "duplicated start",
      () => {
        const p = q(S0900, S1000, "1");
        p.append("start", S0930);
        return p;
      },
    ],
  ];

  it.each(invalid)("rejects %s with invalid_query", (_name, build) => {
    const result = findAvailableRooms(threeRooms(), build());
    expect(result).toEqual({ ok: false, code: "invalid_query" });
  });
});

describe("availability: contract for GET /availability", () => {
  // @covers room-booking-api:CTR-006
  it("lists r2 only when r3 is busy for 09:00Z-09:30Z and attendees is 8", () => {
    const result = findAvailableRooms(withR3Booking(), q(S0900, S0930, "8"));
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [{ id: "r2", name: "Room r2", capacity: 12 }] },
    });
  });

  it("lists r3 then r2 for the touching interval 10:00Z-10:30Z and attendees 8", () => {
    expect(listedIds(findAvailableRooms(withR3Booking(), q(S1000, S1030, "8")))).toEqual(["r3", "r2"]);
  });

  it("rejects a query without attendees with invalid_query instead of a default", () => {
    expect(findAvailableRooms(withR3Booking(), q(S0930, S1030, null))).toEqual({
      ok: false,
      code: "invalid_query",
    });
  });
});

describe("availability: narrows after a booking", () => {
  // @covers room-booking-api:SCN-002
  it("lists r3 then r2, then r3 only after r2 is booked, then no rooms once r3 is booked too", () => {
    const store = threeRooms();
    const query = () => q(S0900, S1000, "5");

    expect(listedIds(findAvailableRooms(store, query()))).toEqual(["r3", "r2"]);

    book(store, "r2", S0900, S1000);
    expect(listedIds(findAvailableRooms(store, query()))).toEqual(["r3"]);

    book(store, "r3", S0900, S1000);
    expect(findAvailableRooms(store, query())).toEqual({ ok: true, status: 200, body: { rooms: [] } });
  });
});
