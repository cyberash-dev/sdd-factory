import { describe, it, expect } from "vitest";
import { createStore } from "../../src/core/index.js";
import type { HandlerResponse, Store } from "../../src/core/index.js";
import { createBookingCreateRoutes } from "../../src/booking-create/index.js";

const D = "2026-11-02T";
const ms = (hhmm: string): number => Date.parse(`${D}${hhmm}:00Z`);
const t = (hhmm: string): string => `${D}${hhmm}:00Z`;

function setup(rooms: number[] = [10]) {
  const store = createStore();
  for (const [i, capacity] of rooms.entries()) {
    store.addRoom({ name: `Room ${i + 1}`, capacity });
  }
  const routes = createBookingCreateRoutes(store);
  const route = routes.find((r) => r.method === "POST" && r.path === "/rooms/:roomId/bookings");
  if (!route) throw new Error("POST /rooms/:roomId/bookings route missing");
  const post = (roomId: string, body: unknown): HandlerResponse =>
    route.handle({ params: { roomId }, query: new URLSearchParams(), body });
  return { store, routes, route, post };
}

function seed(store: Store, roomId: string, from: string, to: string) {
  return store.addBooking({
    roomId,
    title: "Seed",
    start: t(from),
    end: t(to),
    startMs: ms(from),
    endMs: ms(to),
    attendees: 1,
  });
}

const valid = (over: Record<string, unknown> = {}) => ({
  title: "Standup",
  start: t("09:00"),
  end: t("10:00"),
  attendees: 5,
  ...over,
});

const ids = (store: Store, roomId: string) => store.bookingsOf(roomId).map((b) => b.id);

describe("Booking creation route table", () => {
  it("registers POST /rooms/:roomId/bookings expecting a JSON body", () => {
    const { routes } = setup();
    const post = routes.filter((r) => r.method === "POST" && r.path === "/rooms/:roomId/bookings");
    expect(post).toHaveLength(1);
    expect(post[0]?.expectsJsonBody).toBe(true);
  });
});

describe("Booking creation (BEH-008, CTR-003)", () => {
  // @covers room-booking-api:BEH-008
  it("creates the first Booking with id b1 and echoes the submitted fields", () => {
    const { post, store } = setup();
    const res = post("r1", {
      title: "Standup",
      start: t("09:00"),
      end: t("09:30"),
      attendees: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "b1",
      roomId: "r1",
      title: "Standup",
      start: "2026-11-02T09:00:00Z",
      end: "2026-11-02T09:30:00Z",
      attendees: 5,
    });
    expect(ids(store, "r1")).toEqual(["b1"]);
  });

  it("takes the next global id when another Room already holds a Booking", () => {
    const { post, store } = setup([10, 10]);
    seed(store, "r2", "09:00", "10:00");
    const res = post("r1", valid());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "b2", roomId: "r1" });
  });

  it("drops an extra member from the response and from the stored Booking", () => {
    const { post, store } = setup();
    const res = post("r1", valid({ notes: "weekly" }));
    expect(res.status).toBe(201);
    expect(Object.keys(res.body as object).sort()).toEqual(
      ["attendees", "end", "id", "roomId", "start", "title"],
    );
    expect(Object.keys(store.bookingsOf("r1")[0] ?? {}).sort()).toEqual(
      ["attendees", "end", "id", "roomId", "start", "title"],
    );
  });

  // @covers room-booking-api:CTR-003
  it("answers each invalid class of the contract with its own status and code", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    expect(post("r1", valid({ start: t("11:00"), end: t("11:30") })).status).toBe(201);
    expect(post("r9", valid())).toEqual({ status: 404, body: { error: "room_not_found" } });
    expect(post("r1", valid({ start: t("13:00"), end: t("14:00"), title: "" }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
    expect(post("r1", valid({ start: t("13:00"), end: t("14:00"), attendees: 11 }))).toEqual({
      status: 422,
      body: { error: "over_capacity" },
    });
    expect(post("r1", valid({ start: t("09:30"), end: t("10:30") }))).toEqual({
      status: 409,
      body: { error: "room_busy", conflictingBookingId: "b1" },
    });
  });
});

describe("Room existence (BEH-009)", () => {
  // @covers room-booking-api:BEH-009
  it.each(["r9", "r99"])("answers room_not_found for the absent Room %s and stores nothing", (roomId) => {
    const { post, store } = setup();
    const res = post(roomId, valid());
    expect(res).toEqual({ status: 404, body: { error: "room_not_found" } });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });

  it("answers room_not_found on a Store holding no Room", () => {
    const { post } = setup([]);
    expect(post("r1", valid())).toEqual({ status: 404, body: { error: "room_not_found" } });
  });

  it("answers 201 for the existing Room r1", () => {
    const { post } = setup();
    expect(post("r1", valid()).status).toBe(201);
  });
});

describe("Title rules (BEH-010)", () => {
  // @covers room-booking-api:BEH-010
  it.each([
    ["empty", ""],
    ["81 characters", "A".repeat(81)],
    ["number", 42],
    ["null", null],
  ])("rejects a %s title with invalid_booking and stores nothing", (_n, title) => {
    const { post, store } = setup();
    expect(post("r1", valid({ title }))).toEqual({ status: 400, body: { error: "invalid_booking" } });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });

  it("rejects an absent title with invalid_booking", () => {
    const { post, store } = setup();
    const { title: _t, ...noTitle } = valid();
    expect(post("r1", noTitle)).toEqual({ status: 400, body: { error: "invalid_booking" } });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });

  it.each(["A".repeat(80), " "])("accepts and echoes the title %j verbatim", (title) => {
    const { post } = setup();
    const res = post("r1", valid({ title }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title });
  });
});

describe("Interval order and length (BEH-013, BEH-014)", () => {
  // @covers room-booking-api:BEH-013
  it.each([
    ["end before start", "10:00", "09:00"],
    ["end equal to start", "10:00", "10:00"],
  ])("rejects %s with invalid_booking and stores nothing", (_n, start, end) => {
    const { post, store } = setup();
    expect(post("r1", valid({ start: t(start), end: t(end) }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });

  it("accepts an end one minute after start", () => {
    const { post } = setup();
    const res = post("r1", valid({ start: t("09:00"), end: t("09:01") }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ start: "2026-11-02T09:00:00Z", end: "2026-11-02T09:01:00Z" });
  });

  it("rejects an unparseable time with invalid_booking", () => {
    const { post } = setup();
    expect(post("r1", valid({ start: "tomorrow" }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
    expect(post("r1", valid({ end: undefined }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
  });

  // @covers room-booking-api:BEH-014
  it("accepts exactly 8 hours and rejects 8 hours and one minute", () => {
    const { post, store } = setup();
    const ok = post("r1", valid({ start: t("09:00"), end: t("17:00") }));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ start: "2026-11-02T09:00:00Z", end: "2026-11-02T17:00:00Z" });
    const tooLong = post("r1", valid({ start: t("00:00"), end: "2026-11-02T08:01:00Z" }));
    expect(tooLong).toEqual({ status: 400, body: { error: "invalid_booking" } });
    expect(ids(store, "r1")).toEqual(["b1"]);
  });

  it("rejects 09:00 to 17:01 with invalid_booking on an empty Room", () => {
    const { post, store } = setup();
    expect(post("r1", valid({ start: t("09:00"), end: t("17:01") }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });

  it("accepts 09:00 to 16:59", () => {
    const { post } = setup();
    expect(post("r1", valid({ start: t("09:00"), end: t("16:59") })).status).toBe(201);
  });
});

describe("Attendees and capacity (BEH-015)", () => {
  // @covers room-booking-api:BEH-015
  it("answers 422 over_capacity for attendees 11 on capacity 10 and stores nothing", () => {
    const { post, store } = setup();
    expect(post("r1", valid({ attendees: 11 }))).toEqual({ status: 422, body: { error: "over_capacity" } });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });

  it("accepts attendees equal to the capacity", () => {
    const { post } = setup();
    const res = post("r1", valid({ attendees: 10 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ attendees: 10 });
  });

  it.each([0, -1, 2.5, "5", null])("rejects attendees %j with invalid_booking", (attendees) => {
    const { post, store } = setup();
    expect(post("r1", valid({ attendees }))).toEqual({ status: 400, body: { error: "invalid_booking" } });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });

  it("rejects an absent attendees member with invalid_booking", () => {
    const { post, store } = setup();
    const { attendees: _a, ...none } = valid();
    expect(post("r1", none)).toEqual({ status: 400, body: { error: "invalid_booking" } });
    expect(store.bookingsOf("r1")).toHaveLength(0);
  });
});

describe("Conflict (BEH-016, BEH-017, SCN-004)", () => {
  // @covers room-booking-api:BEH-016
  it("answers 409 room_busy naming the earliest-starting conflict and stores nothing", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r1", "11:00", "12:00");
    const res = post("r1", valid({ start: t("09:30"), end: t("11:30") }));
    expect(res).toEqual({ status: 409, body: { error: "room_busy", conflictingBookingId: "b1" } });
    expect(ids(store, "r1")).toEqual(["b1", "b2"]);
  });

  it("accepts a free interval and the same interval on another Room", () => {
    const { post, store } = setup([10, 10]);
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r1", "11:00", "12:00");
    expect(post("r1", valid({ start: t("13:00"), end: t("14:00") })).status).toBe(201);
    expect(post("r2", valid({ start: t("09:30"), end: t("11:30") })).status).toBe(201);
  });

  it("names b1 for a one-conflict interval 09:30 to 09:45", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r1", "11:00", "12:00");
    expect(post("r1", valid({ start: t("09:30"), end: t("09:45") }))).toEqual({
      status: 409,
      body: { error: "room_busy", conflictingBookingId: "b1" },
    });
  });

  it("names the earliest-starting conflict even when it has the later id", () => {
    const { post, store } = setup();
    seed(store, "r1", "11:00", "12:00");
    seed(store, "r1", "09:00", "10:00");
    expect(post("r1", valid({ start: t("09:30"), end: t("11:30") })).body).toEqual({
      error: "room_busy",
      conflictingBookingId: "b2",
    });
  });

  // @covers room-booking-api:BEH-017
  it("accepts adjacent half-open intervals after and before an existing Booking", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    expect(post("r1", valid({ start: t("10:00"), end: t("11:00") })).status).toBe(201);
    expect(post("r1", valid({ start: t("08:00"), end: t("09:00") })).status).toBe(201);
    expect(store.bookingsOf("r1")).toHaveLength(3);
  });

  it("answers room_busy for a one-minute overlap 09:59 to 10:01", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    expect(post("r1", valid({ start: t("09:59"), end: t("10:01") }))).toEqual({
      status: 409,
      body: { error: "room_busy", conflictingBookingId: "b1" },
    });
    expect(store.bookingsOf("r1")).toHaveLength(1);
  });

  // @covers room-booking-api:SCN-004
  it("names b1, then b2 after b1 is freed, and repeats b1 for a repeated request", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    seed(store, "r1", "11:00", "12:00");
    const req = valid({ start: t("09:30"), end: t("11:30") });
    const first = { status: 409, body: { error: "room_busy", conflictingBookingId: "b1" } };
    expect(post("r1", req)).toEqual(first);
    expect(post("r1", req)).toEqual(first);
    expect(store.removeBooking("b1")).toBe(true);
    expect(post("r1", req)).toEqual({
      status: 409,
      body: { error: "room_busy", conflictingBookingId: "b2" },
    });
  });
});

describe("Error precedence (BEH-028)", () => {
  // @covers room-booking-api:BEH-028
  it("answers room_not_found before invalid_booking for an unknown Room", () => {
    const { post } = setup();
    expect(post("r9", valid({ title: "" }))).toEqual({ status: 404, body: { error: "room_not_found" } });
  });

  it("answers invalid_booking before room_busy for an invalid body with a conflict", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    expect(post("r1", valid({ title: "", start: t("09:30"), end: t("10:30") }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
  });

  it("answers over_capacity before room_busy for attendees 11 with a conflict", () => {
    const { post, store } = setup();
    seed(store, "r1", "09:00", "10:00");
    expect(post("r1", valid({ attendees: 11, start: t("09:30"), end: t("10:30") }))).toEqual({
      status: 422,
      body: { error: "over_capacity" },
    });
  });

  it("answers invalid_booking before over_capacity for an invalid interval with attendees 11", () => {
    const { post } = setup();
    expect(post("r1", valid({ attendees: 11, start: t("10:00"), end: t("10:00") }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
  });

  it("answers 201 for a request breaking a single rule's opposite", () => {
    const { post } = setup();
    expect(post("r1", valid()).status).toBe(201);
  });
});

describe("Booking id sequence (SCN-002)", () => {
  // @covers room-booking-api:SCN-002
  it("assigns b1, b2, b3 across Rooms in creation order and lists b1 and b3 for r1", () => {
    const { post, store } = setup([10, 10]);
    expect(post("r1", valid({ start: t("09:00"), end: t("10:00") })).body).toMatchObject({ id: "b1" });
    expect(post("r2", valid({ start: t("09:00"), end: t("10:00") })).body).toMatchObject({ id: "b2", roomId: "r2" });
    expect(post("r1", valid({ start: t("11:00"), end: t("12:00") })).body).toMatchObject({ id: "b3" });
    expect(ids(store, "r1")).toEqual(["b1", "b3"]);
  });

  it("consumes no id for a rejected creation", () => {
    const { post, store } = setup([10, 10]);
    post("r1", valid());
    post("r2", valid());
    expect(post("r1", valid({ title: "" })).status).toBe(400);
    expect(post("r1", valid({ start: t("11:00"), end: t("12:00") })).body).toMatchObject({ id: "b3" });
    expect(ids(store, "r1")).toEqual(["b1", "b3"]);
  });
});
