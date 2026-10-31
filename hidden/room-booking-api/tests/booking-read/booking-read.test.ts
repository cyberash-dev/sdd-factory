import { describe, it, expect } from "vitest";
import { createStore } from "../../src/core/index.js";
import type { HandlerResponse, Store } from "../../src/core/index.js";
import { createBookingReadRoutes } from "../../src/booking-read/index.js";
import { createBookingCreateRoutes } from "../../src/booking-create/index.js";

const D = "2026-11-02T";
const t = (hhmm: string): string => `${D}${hhmm}:00Z`;
const ms = (hhmm: string): number => Date.parse(t(hhmm));

function setup(capacities: number[] = [10]) {
  const store = createStore();
  for (const [i, capacity] of capacities.entries()) {
    store.addRoom({ name: `Room ${i + 1}`, capacity });
  }
  const routes = createBookingReadRoutes(store);
  const find = (method: string, path: string) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route missing`);
    return route;
  };
  const list = (roomId: string, query: string = ""): HandlerResponse =>
    find("GET", "/rooms/:roomId/bookings").handle({
      params: { roomId },
      query: new URLSearchParams(query),
      body: undefined,
    });
  const del = (bookingId: string): HandlerResponse =>
    find("DELETE", "/bookings/:bookingId").handle({
      params: { bookingId },
      query: new URLSearchParams(),
      body: undefined,
    });
  const avail = (query: string): HandlerResponse =>
    find("GET", "/availability").handle({
      params: {},
      query: new URLSearchParams(query),
      body: undefined,
    });
  const create = (roomId: string, from: string, to: string): HandlerResponse => {
    const route = createBookingCreateRoutes(store).find(
      (r) => r.method === "POST" && r.path === "/rooms/:roomId/bookings",
    );
    if (!route) throw new Error("POST route missing");
    return route.handle({
      params: { roomId },
      query: new URLSearchParams(),
      body: { title: "New", start: t(from), end: t(to), attendees: 1 },
    });
  };
  return { store, routes, list, del, avail, create };
}

function seed(store: Store, roomId: string, from: string, to: string, title = "Seed") {
  return store.addBooking({
    roomId,
    title,
    start: t(from),
    end: t(to),
    startMs: ms(from),
    endMs: ms(to),
    attendees: 1,
  });
}

const view = (id: string, roomId: string, from: string, to: string, title = "Seed") => ({
  id,
  roomId,
  title,
  start: t(from),
  end: t(to),
  attendees: 1,
});

const listedIds = (res: HandlerResponse): string[] =>
  ((res.body as { bookings: { id: string }[] }).bookings ?? []).map((b) => b.id);

const roomIds = (res: HandlerResponse): string[] =>
  ((res.body as { rooms: { id: string }[] }).rooms ?? []).map((r) => r.id);

const INVALID_QUERY = { status: 400, body: { error: "invalid_query" } };

describe("Booking read route table", () => {
  it("registers the three Routes without a JSON body", () => {
    const { routes } = setup();
    const keys = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(keys).toEqual([
      "DELETE /bookings/:bookingId",
      "GET /availability",
      "GET /rooms/:roomId/bookings",
    ]);
    expect(routes.every((r) => !r.expectsJsonBody)).toBe(true);
  });
});

describe("Booking listing order (BEH-018, CTR-004)", () => {
  // @covers room-booking-api:BEH-018
  it("lists Bookings by start ascending, equal starts by id, with exactly the six members", () => {
    const { store, list } = setup();
    seed(store, "r1", "11:00", "11:30", "First");
    seed(store, "r1", "09:00", "10:00", "Second");
    seed(store, "r1", "11:00", "12:00", "Third");
    const res = list("r1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bookings: [
        view("b2", "r1", "09:00", "10:00", "Second"),
        view("b1", "r1", "11:00", "11:30", "First"),
        view("b3", "r1", "11:00", "12:00", "Third"),
      ],
    });
  });

  it("answers an empty bookings list for a Room without Bookings", () => {
    const { list } = setup();
    expect(list("r1")).toEqual({ status: 200, body: { bookings: [] } });
  });

  it("orders ten Bookings with an equal start by numeric id, b2 before b10", () => {
    const { store, list } = setup();
    for (let i = 0; i < 10; i++) seed(store, "r1", "09:00", "10:00");
    expect(listedIds(list("r1"))).toEqual([
      "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10",
    ]);
  });

  it("does not return Bookings of another Room", () => {
    const { store, list } = setup([10, 4]);
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r2", "09:00", "10:00");
    expect(listedIds(list("r2"))).toEqual(["b2"]);
  });

  // @covers room-booking-api:CTR-004
  it("answers 200 with the ordered member Bookings for no query and for a valid window, 404 for an unknown Room", () => {
    const { store, list } = setup();
    seed(store, "r1", "11:00", "12:00");
    seed(store, "r1", "09:00", "10:00");
    const all = list("r1");
    expect(all.status).toBe(200);
    expect(listedIds(all)).toEqual(["b2", "b1"]);
    const windowed = list("r1", `from=${t("09:30")}&to=${t("11:30")}`);
    expect(windowed.status).toBe(200);
    expect(listedIds(windowed)).toEqual(["b2", "b1"]);
    expect(list("r9")).toEqual({ status: 404, body: { error: "room_not_found" } });
  });

  it("answers invalid_query, not room_not_found, for an unknown Room with a half-given window", () => {
    const { list } = setup();
    expect(list("r9", `from=${t("09:00")}`)).toEqual(INVALID_QUERY);
  });
});

describe("Booking listing window filter (BEH-019)", () => {
  // @covers room-booking-api:BEH-019
  it("includes every Booking that overlaps the half-open Interval and excludes touching ones", () => {
    const { store, list } = setup();
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r1", "11:00", "12:00");
    expect(listedIds(list("r1", `from=${t("09:30")}&to=${t("11:30")}`))).toEqual(["b1", "b2"]);
    expect(list("r1", `from=${t("10:00")}&to=${t("11:00")}`)).toEqual({
      status: 200,
      body: { bookings: [] },
    });
    expect(listedIds(list("r1", `from=${t("09:00")}&to=${t("11:00")}`))).toEqual(["b1"]);
  });

  it("includes a Booking that contains the whole window", () => {
    const { store, list } = setup();
    seed(store, "r1", "09:00", "10:00");
    expect(listedIds(list("r1", `from=${t("09:15")}&to=${t("09:45")}`))).toEqual(["b1"]);
  });

  it("answers an empty list for a window over an empty Room", () => {
    const { list } = setup([10, 4]);
    expect(list("r2", `from=${t("09:00")}&to=${t("10:00")}`)).toEqual({
      status: 200,
      body: { bookings: [] },
    });
  });

  it("keeps the start-then-id order inside a filtered list", () => {
    const { store, list } = setup();
    seed(store, "r1", "10:00", "11:00");
    seed(store, "r1", "09:00", "10:00");
    expect(listedIds(list("r1", `from=${t("09:00")}&to=${t("11:00")}`))).toEqual(["b2", "b1"]);
  });
});

describe("Booking listing invalid window (BEH-020)", () => {
  // @covers room-booking-api:BEH-020
  it("answers 400 invalid_query for an incomplete, non-Z, non-whole-minute, unparseable or inverted pair", () => {
    const { store, list } = setup();
    seed(store, "r1", "09:00", "10:00");
    const cases: Record<string, string> = {
      "only from": `from=${t("09:00")}`,
      "only to": `to=${t("10:00")}`,
      "to equal to from": `from=${t("10:00")}&to=${t("10:00")}`,
      "to before from": `from=${t("11:00")}&to=${t("09:00")}`,
      "offset time": `from=2026-11-02T09:00:00%2B02:00&to=${t("10:00")}`,
      "seconds": `from=2026-11-02T09:00:30Z&to=${t("10:00")}`,
      "unparseable": `from=tomorrow&to=${t("10:00")}`,
    };
    for (const [label, query] of Object.entries(cases)) {
      expect(list("r1", query), label).toEqual(INVALID_QUERY);
    }
    const ok = list("r1", `from=${t("09:00")}&to=${t("10:00")}`);
    expect(ok.status).toBe(200);
    expect(listedIds(ok)).toEqual(["b1"]);
  });
});

describe("Booking deletion (BEH-021, BEH-022, CTR-005)", () => {
  // @covers room-booking-api:BEH-021
  it("answers 204 without a body, drops the Booking from the list and frees its Interval", () => {
    const { store, list, del, create } = setup();
    seed(store, "r1", "09:00", "10:00");
    const res = del("b1");
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(list("r1")).toEqual({ status: 200, body: { bookings: [] } });
    const again = create("r1", "09:30", "10:30");
    expect(again.status).toBe(201);
    expect(del("b1")).toEqual({ status: 404, body: { error: "booking_not_found" } });
  });

  // @covers room-booking-api:BEH-022
  it("answers 404 booking_not_found for a never created id and for a deleted id, never not_found", () => {
    const { store, del } = setup();
    seed(store, "r1", "09:00", "10:00");
    const notFound = { status: 404, body: { error: "booking_not_found" } };
    expect(del("b7")).toEqual(notFound);
    expect(del("b1").status).toBe(204);
    expect(del("b1")).toEqual(notFound);
  });

  // @covers room-booking-api:CTR-005
  it("answers 204 with no body for a known id and 404 booking_not_found for an unknown or deleted id", () => {
    const { store, del } = setup();
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r1", "10:00", "11:00");
    const ok = del("b2");
    expect(ok.status).toBe(204);
    expect("body" in ok && ok.body !== undefined).toBe(false);
    expect(del("b2")).toEqual({ status: 404, body: { error: "booking_not_found" } });
    expect(del("b9")).toEqual({ status: 404, body: { error: "booking_not_found" } });
  });

  it("removes only the named Booking", () => {
    const { store, list, del } = setup();
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r1", "10:00", "11:00");
    del("b1");
    expect(listedIds(list("r1"))).toEqual(["b2"]);
  });
});

describe("Availability listing (BEH-023, CTR-006)", () => {
  const fixture = () => {
    const ctx = setup([10, 4, 10, 4]);
    seed(ctx.store, "r1", "09:00", "10:00");
    seed(ctx.store, "r4", "09:30", "10:30");
    return ctx;
  };
  const q = (attendees: string) => `start=${t("09:00")}&end=${t("10:00")}&attendees=${attendees}`;

  // @covers room-booking-api:BEH-023
  it("lists the free Rooms with enough capacity, ordered by capacity then id, and omits busy Rooms", () => {
    const { avail } = fixture();
    const res = avail(q("4"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rooms: [
        { id: "r2", name: "Room 2", capacity: 4 },
        { id: "r3", name: "Room 3", capacity: 10 },
      ],
    });
  });

  it("answers an empty rooms list when attendees exceeds every capacity", () => {
    const { avail } = fixture();
    expect(avail(q("11"))).toEqual({ status: 200, body: { rooms: [] } });
  });

  it("qualifies a Room whose capacity equals attendees", () => {
    const { avail } = fixture();
    expect(roomIds(avail(q("10")))).toEqual(["r3"]);
  });

  it("lists a capacity-4 Room created after a capacity-10 Room first, equal capacities by id", () => {
    const { avail } = setup([10, 4, 4]);
    expect(roomIds(avail(q("1")))).toEqual(["r2", "r3", "r1"]);
  });

  it("treats a Booking adjacent to the requested Interval as no conflict", () => {
    const { store, avail } = setup([4]);
    seed(store, "r1", "10:00", "11:00");
    seed(store, "r1", "08:00", "09:00");
    expect(roomIds(avail(q("4")))).toEqual(["r1"]);
  });

  // @covers room-booking-api:CTR-006
  it("answers 200 with exactly the member Rooms and 400 invalid_query for a missing parameter", () => {
    const { avail } = fixture();
    const res = avail(q("4"));
    expect(res.status).toBe(200);
    expect(roomIds(res)).toEqual(["r2", "r3"]);
    expect(Object.keys(res.body as object)).toEqual(["rooms"]);
    expect(avail(`start=${t("09:00")}&attendees=4`)).toEqual(INVALID_QUERY);
  });
});

describe("Availability invalid parameters (BEH-024)", () => {
  // @covers room-booking-api:BEH-024
  it("answers 400 invalid_query for each missing or invalid parameter and still serves a valid query", () => {
    const { avail } = setup([4]);
    const s = t("09:00");
    const e = t("10:00");
    const cases: Record<string, string> = {
      "missing start": `end=${e}&attendees=4`,
      "missing end": `start=${s}&attendees=4`,
      "missing attendees": `start=${s}&end=${e}`,
      "start equal to end": `start=${e}&end=${e}&attendees=4`,
      "end before start": `start=${e}&end=${s}&attendees=4`,
      "unparseable start": `start=tomorrow&end=${e}&attendees=4`,
      "offset time": `start=2026-11-02T09:00:00%2B02:00&end=${e}&attendees=4`,
      "seconds": `start=2026-11-02T09:00:30Z&end=${e}&attendees=4`,
      "fractional attendees": `start=${s}&end=${e}&attendees=2.5`,
      "non-numeric attendees": `start=${s}&end=${e}&attendees=abc`,
    };
    for (const [label, query] of Object.entries(cases)) {
      expect(avail(query), label).toEqual(INVALID_QUERY);
    }
    const ok = avail(`start=${s}&end=${e}&attendees=4`);
    expect(ok.status).toBe(200);
    expect(roomIds(ok)).toEqual(["r1"]);
  });
});

describe("Deleting a Booking frees its Interval (SCN-003)", () => {
  // @covers room-booking-api:SCN-003
  it("rejects a conflicting creation, deletes b1, then accepts the same creation with a fresh id", () => {
    const { store, list, del, create } = setup();
    seed(store, "r1", "09:00", "10:00");
    const busy = create("r1", "09:30", "10:30");
    expect(busy).toEqual({ status: 409, body: { error: "room_busy", conflictingBookingId: "b1" } });
    const deleted = del("b1");
    expect(deleted.status).toBe(204);
    expect(deleted.body).toBeUndefined();
    const created = create("r1", "09:30", "10:30");
    expect(created.status).toBe(201);
    expect((created.body as { id: string }).id).toBe("b2");
    expect(list("r1")).toEqual({
      status: 200,
      body: { bookings: [{ id: "b2", roomId: "r1", title: "New", start: t("09:30"), end: t("10:30"), attendees: 1 }] },
    });
  });

  it("accepts an adjacent and an inner Interval after the deletion", () => {
    const { store, del, create } = setup();
    seed(store, "r1", "09:00", "10:00");
    del("b1");
    expect(create("r1", "10:00", "11:00").status).toBe(201);
    expect(create("r1", "09:15", "09:45").status).toBe(201);
  });
});
