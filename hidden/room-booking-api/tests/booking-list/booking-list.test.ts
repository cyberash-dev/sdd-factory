import { describe, expect, it } from "vitest";
import { createStore } from "../../src/store/index.js";
import type { Store } from "../../src/store/index.js";
import type { HandlerResult } from "../../src/errors/index.js";
import { listBookings } from "../../src/booking-list/index.js";

const D = "2026-11-02";

function add(store: Store, roomId: string, from: string, to: string): string {
  return store.bookings.create({
    roomId,
    title: "t",
    start: `${D}T${from}:00Z`,
    end: `${D}T${to}:00Z`,
    attendees: 1,
  }).id;
}

function seedThree(): Store {
  const store = createStore();
  store.rooms.create("alpha", 10);
  add(store, "r1", "09:00", "10:00");
  add(store, "r1", "10:00", "11:00");
  add(store, "r1", "13:00", "14:00");
  return store;
}

function ids(result: HandlerResult): string[] {
  if (!result.ok) return [`failure:${result.code}`];
  return (result.body as { bookings: { id: string }[] }).bookings.map((b) => b.id);
}

function list(store: Store, roomId: string, qs = ""): HandlerResult {
  return listBookings(store, roomId, new URLSearchParams(qs));
}

describe("booking listing order", () => {
  // @covers room-booking-api:BEH-011
  it("lists the Bookings of a Room by ascending start regardless of creation order", () => {
    const store = createStore();
    store.rooms.create("alpha", 10);
    add(store, "r1", "09:00", "10:00");
    add(store, "r1", "08:00", "09:00");
    add(store, "r1", "10:00", "11:00");
    const result = list(store, "r1");
    expect(result.ok && result.status).toBe(200);
    expect(ids(result)).toEqual(["b2", "b1", "b3"]);
  });

  it("breaks equal starts by ascending numeric id", () => {
    const store = createStore();
    store.rooms.create("alpha", 10);
    for (let i = 1; i <= 10; i++) add(store, "r1", "09:00", `${String(9 + i).padStart(2, "0")}:00`);
    expect(ids(list(store, "r1"))).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10"]);
  });

  it("excludes Bookings of another Room", () => {
    const store = createStore();
    store.rooms.create("alpha", 10);
    store.rooms.create("beta", 10);
    add(store, "r2", "07:00", "08:00");
    add(store, "r1", "09:00", "10:00");
    expect(ids(list(store, "r1"))).toEqual(["b2"]);
  });

  it("returns the full Booking wire shape", () => {
    const store = createStore();
    store.rooms.create("alpha", 10);
    add(store, "r1", "09:00", "10:00");
    expect(list(store, "r1")).toEqual({
      ok: true,
      status: 200,
      body: {
        bookings: [
          { id: "b1", roomId: "r1", title: "t", start: "2026-11-02T09:00:00Z", end: "2026-11-02T10:00:00Z", attendees: 1 },
        ],
      },
    });
  });
});

describe("booking listing filter", () => {
  // @covers room-booking-api:BEH-012
  it("keeps the Bookings overlapping the half-open filter interval in start order", () => {
    const result = list(seedThree(), "r1", "from=2026-11-02T09:30:00Z&to=2026-11-02T11:00:00Z");
    expect(result.ok && result.status).toBe(200);
    expect(ids(result)).toEqual(["b1", "b2"]);
  });

  it.each([
    ["booking ending exactly at from", "from=2026-11-02T10:00:00Z&to=2026-11-02T12:00:00Z", ["b2"]],
    ["booking starting exactly at to", "from=2026-11-02T07:00:00Z&to=2026-11-02T09:00:00Z", []],
    ["booking fully inside", "from=2026-11-02T13:15:00Z&to=2026-11-02T13:45:00Z", ["b3"]],
    ["no booking overlapping", "from=2026-11-02T11:00:00Z&to=2026-11-02T13:00:00Z", []],
    ["filter inside the gap before everything", "from=2026-11-02T06:00:00Z&to=2026-11-02T07:00:00Z", []],
  ])("filters the Booking list: %s", (_name, qs, expected) => {
    const result = list(seedThree(), "r1", qs);
    expect(result.ok && result.status).toBe(200);
    expect(ids(result)).toEqual(expected);
  });

  it("returns every Booking when no filter is supplied", () => {
    expect(ids(list(seedThree(), "r1"))).toEqual(["b1", "b2", "b3"]);
  });
});

describe("booking listing invalid filter", () => {
  // @covers room-booking-api:BEH-013
  it.each([
    ["only from", "from=2026-11-02T09:00:00Z"],
    ["only to", "to=2026-11-02T10:00:00Z"],
    ["to before from", "from=2026-11-02T10:00:00Z&to=2026-11-02T09:00:00Z"],
    ["to equal to from", "from=2026-11-02T09:00:00Z&to=2026-11-02T09:00:00Z"],
    ["unparseable from", "from=not-a-time&to=2026-11-02T10:00:00Z"],
    ["unparseable to", "from=2026-11-02T09:00:00Z&to=not-a-time"],
    ["offset times", "from=2026-11-02T09:00:00%2B01:00&to=2026-11-02T10:00:00%2B01:00"],
    ["lenient time without seconds", "from=2026-11-02T09:00Z&to=2026-11-02T10:00Z"],
    ["empty from value", "from=&to=2026-11-02T10:00:00Z"],
  ])("rejects %s with invalid_query", (_name, qs) => {
    const result = list(seedThree(), "r1", qs);
    expect(result).toMatchObject({ ok: false, code: "invalid_query" });
  });

  it("accepts a well-formed from and to pair", () => {
    const result = list(seedThree(), "r1", "from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z");
    expect(result.ok && result.status).toBe(200);
    expect(ids(result)).toEqual(["b1"]);
  });
});

describe("booking listing of a Room", () => {
  // @covers room-booking-api:BEH-020
  it("rejects an unknown Room with room_not_found", () => {
    const store = createStore();
    store.rooms.create("alpha", 10);
    expect(list(store, "r9")).toMatchObject({ ok: false, code: "room_not_found" });
  });

  it("rejects any Room on an empty store with room_not_found", () => {
    expect(list(createStore(), "r1")).toMatchObject({ ok: false, code: "room_not_found" });
  });

  it("answers 200 with an empty bookings array for an existing Room without Bookings", () => {
    const store = createStore();
    store.rooms.create("alpha", 10);
    expect(list(store, "r1")).toEqual({ ok: true, status: 200, body: { bookings: [] } });
  });

  it("answers 200 with the Booking of an existing Room with one Booking", () => {
    const store = createStore();
    store.rooms.create("alpha", 10);
    add(store, "r1", "09:00", "10:00");
    expect(ids(list(store, "r1"))).toEqual(["b1"]);
  });

  it("rejects an unknown Room even when a valid filter is supplied", () => {
    const store = createStore();
    expect(list(store, "r9", "from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z")).toMatchObject({
      ok: false,
      code: "room_not_found",
    });
  });
});

describe("list room bookings contract", () => {
  // @covers room-booking-api:CTR-004
  it("orders unfiltered Bookings by start then id and keeps only overlapping ones for a filter", () => {
    const store = seedThree();
    expect(ids(list(store, "r1"))).toEqual(["b1", "b2", "b3"]);
    expect(ids(list(store, "r1", "from=2026-11-02T10:00:00Z&to=2026-11-02T11:00:00Z"))).toEqual(["b2"]);
    expect(ids(list(store, "r1", "from=2026-11-02T08:00:00Z&to=2026-11-02T12:00:00Z"))).toEqual(["b1", "b2"]);
  });

  it("rejects a one-sided filter with invalid_query and an unknown Room with room_not_found", () => {
    const store = seedThree();
    expect(list(store, "r1", "to=2026-11-02T12:00:00Z")).toMatchObject({ ok: false, code: "invalid_query" });
    expect(list(store, "r9")).toMatchObject({ ok: false, code: "room_not_found" });
  });
});
