import { describe, expect, it } from "vitest";
import { createStore } from "../../../src/core/index.js";
import type { ParsedBody, Store } from "../../../src/core/index.js";
import { handleCreateBooking } from "../../../src/routes/booking-create/index.js";

const D = "2026-11-02";

function value(v: unknown): ParsedBody {
  return { kind: "value", value: v };
}

function req(over: Record<string, unknown> = {}): ParsedBody {
  return value({
    title: "Standup",
    start: `${D}T09:30:00Z`,
    end: `${D}T10:00:00Z`,
    attendees: 4,
    ...over,
  });
}

function seed(store: Store, roomId: string, id: string, startH: number, endH: number): void {
  // id only documents which booking the seed is expected to become
  void id;
  const s = Date.UTC(2026, 10, 2, startH, 0, 0);
  const e = Date.UTC(2026, 10, 2, endH, 0, 0);
  const iso = (h: number) => `${D}T${String(h).padStart(2, "0")}:00:00Z`;
  store.addBooking({
    roomId,
    title: "seed",
    start: iso(startH),
    end: iso(endH),
    startMs: s,
    endMs: e,
    attendees: 1,
  });
}

function bookingCount(store: Store, roomId: string): number {
  return store.listBookings(roomId, null).length;
}

describe("booking creation on a room", () => {
  // @covers room-booking-api:BEH-007
  it("a valid request returns 201 with the next booking id across all rooms and lists the Booking", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    for (const h of [13, 14, 15]) seed(store, "r1", "", h, h + 1);
    seed(store, "r1", "b4", 11, 12);
    // b1..b3 above sit at 13-16h, b4 at 11-12h
    const res = handleCreateBooking(store, "r1", req());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "b5",
      roomId: "r1",
      title: "Standup",
      start: "2026-11-02T09:30:00Z",
      end: "2026-11-02T10:00:00Z",
      attendees: 4,
    });
    const listed = store.listBookings("r1", null).map((b) => b.id);
    expect(listed).toContain("b5");
  });

  it("the first Booking of a fresh process gets id b1", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const res = handleCreateBooking(store, "r1", req());
    expect(res.status).toBe(201);
    expect((res.body as { id: string }).id).toBe("b1");
  });

  it("a Booking in a second room gets id b2 and roomId r2", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    store.addRoom("Beta", 10);
    handleCreateBooking(store, "r1", req());
    const res = handleCreateBooking(store, "r2", req());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "b2", roomId: "r2" });
  });

  it("attendees 1 and a title of 80 characters are accepted and echoed", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const title = "t".repeat(80);
    const res = handleCreateBooking(store, "r1", req({ attendees: 1, title }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ attendees: 1, title });
    expect(Object.keys(res.body as object).sort()).toEqual(
      ["attendees", "end", "id", "roomId", "start", "title"],
    );
  });

  it("a rejected request hands out no booking id", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const bad = handleCreateBooking(store, "r1", req({ attendees: 0 }));
    expect(bad.status).toBe(400);
    const ok = handleCreateBooking(store, "r1", req());
    expect(ok.status).toBe(201);
    expect((ok.body as { id: string }).id).toBe("b1");
  });

  // @covers room-booking-api:BEH-008
  it("invalid title, time and duration classes return 400 invalid_booking and store nothing", () => {
    const cases: Record<string, unknown>[] = [
      { title: "" },
      { title: "x".repeat(81) },
      { title: 5 },
      { start: "banana" },
      { start: `${D}T09:30:45Z` },
      { start: `${D}T10:30:00+01:00`, end: `${D}T12:00:00Z` },
      { start: `${D}T09:30:00Z`, end: `${D}T09:30:00Z` },
      { start: `${D}T10:00:00Z`, end: `${D}T09:00:00Z` },
      { start: `${D}T09:00:00Z`, end: `${D}T17:01:00Z` },
      { attendees: 0 },
      { attendees: 1.5 },
      { attendees: "4" },
    ];
    expect.assertions(cases.length * 3);
    for (const over of cases) {
      const store = createStore();
      store.addRoom("Alpha", 10);
      const res = handleCreateBooking(store, "r1", req(over));
      expect(res).toEqual({ status: 400, body: { error: "invalid_booking" } });
      expect(bookingCount(store, "r1")).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain("conflictingBookingId");
    }
  });

  it("a duration of exactly 8 hours is accepted", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const res = handleCreateBooking(
      store,
      "r1",
      req({ start: `${D}T09:00:00Z`, end: `${D}T17:00:00Z` }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "b1", start: "2026-11-02T09:00:00Z", end: "2026-11-02T17:00:00Z" });
  });

  it("a missing field returns 400 invalid_booking", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const res = handleCreateBooking(store, "r1", value({ title: "Standup", start: `${D}T09:30:00Z` }));
    expect(res).toEqual({ status: 400, body: { error: "invalid_booking" } });
  });

  // @covers room-booking-api:BEH-009
  it("an unknown room returns 404 room_not_found whatever the body, and stores nothing", () => {
    const bodies: ParsedBody[] = [
      req(),
      req({ title: "" }),
      { kind: "invalid" },
      { kind: "empty" },
    ];
    expect.assertions(bodies.length * 2);
    for (const body of bodies) {
      const store = createStore();
      store.addRoom("Alpha", 10);
      const res = handleCreateBooking(store, "r9", body);
      expect(res).toEqual({ status: 404, body: { error: "room_not_found" } });
      expect(bookingCount(store, "r1")).toBe(0);
    }
  });

  it("an existing room still accepts a valid body next to an unknown room", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    expect(handleCreateBooking(store, "r9", req()).status).toBe(404);
    const res = handleCreateBooking(store, "r1", req());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "b1", roomId: "r1" });
  });

  // @covers room-booking-api:BEH-010
  it("attendees above the capacity return 422 over_capacity and store nothing", () => {
    expect.assertions(6);
    for (const attendees of [5, 1000]) {
      const store = createStore();
      store.addRoom("Alpha", 4);
      const res = handleCreateBooking(store, "r1", req({ attendees }));
      expect(res).toEqual({ status: 422, body: { error: "over_capacity" } });
      expect(bookingCount(store, "r1")).toBe(0);
      expect(res.status).not.toBe(201);
    }
  });

  it("attendees equal to the capacity return 201", () => {
    const store = createStore();
    store.addRoom("Alpha", 4);
    const res = handleCreateBooking(store, "r1", req({ attendees: 4 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ attendees: 4 });
  });

  it("an empty title with attendees above the capacity returns 400 invalid_booking, never over_capacity", () => {
    const store = createStore();
    store.addRoom("Alpha", 4);
    const res = handleCreateBooking(store, "r1", req({ attendees: 5, title: "" }));
    expect(res).toEqual({ status: 400, body: { error: "invalid_booking" } });
    expect(bookingCount(store, "r1")).toBe(0);
  });

  // @covers room-booking-api:BEH-011
  it("an overlapping interval returns 409 room_busy naming the earliest-starting conflict", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    seed(store, "r1", "b1", 9, 10);
    seed(store, "r1", "b2", 10, 12);
    const res = handleCreateBooking(
      store,
      "r1",
      req({ start: `${D}T08:00:00Z`, end: `${D}T11:00:00Z` }),
    );
    expect(res).toEqual({ status: 409, body: { error: "room_busy", conflictingBookingId: "b1" } });
    expect(bookingCount(store, "r1")).toBe(2);
  });

  it("an interval overlapping only the second Booking names b2", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    seed(store, "r1", "b1", 9, 10);
    seed(store, "r1", "b2", 10, 12);
    const res = handleCreateBooking(
      store,
      "r1",
      req({ start: `${D}T10:00:00Z`, end: `${D}T12:30:00Z` }),
    );
    expect(res).toEqual({ status: 409, body: { error: "room_busy", conflictingBookingId: "b2" } });
  });

  it("intervals touching a Booking at its end or at its start are accepted", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    seed(store, "r1", "b1", 9, 10);
    seed(store, "r1", "b2", 10, 12);
    const after = handleCreateBooking(
      store,
      "r1",
      req({ start: `${D}T12:00:00Z`, end: `${D}T13:00:00Z` }),
    );
    expect(after.status).toBe(201);
    expect(after.body).toMatchObject({ id: "b3" });
    const before = handleCreateBooking(
      store,
      "r1",
      req({ start: `${D}T06:00:00Z`, end: `${D}T09:00:00Z` }),
    );
    expect(before.status).toBe(201);
    expect(before.body).toMatchObject({ id: "b4" });
  });

  // @covers room-booking-api:BEH-012
  it("a body that is not valid JSON returns 400 invalid_json and stores nothing", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const res = handleCreateBooking(store, "r1", { kind: "invalid" });
    expect(res).toEqual({ status: 400, body: { error: "invalid_json" } });
    expect(bookingCount(store, "r1")).toBe(0);
  });

  // Spec record BEH-012 and its verification block name the empty body as invalid_json.
  it("a zero-length body returns 400 invalid_json", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const res = handleCreateBooking(store, "r1", { kind: "empty" });
    expect(res).toEqual({ status: 400, body: { error: "invalid_json" } });
    expect(bookingCount(store, "r1")).toBe(0);
  });

  it("a valid JSON string body returns 400 invalid_booking, never invalid_json", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    expect(handleCreateBooking(store, "r1", value("text"))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
    expect(handleCreateBooking(store, "r1", value(null))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
    expect(handleCreateBooking(store, "r1", value([]))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
  });

  // @covers room-booking-api:CTR-003
  it("the contract answers each declared status and the code precedence holds", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    store.addRoom("Beta", 4);
    expect(handleCreateBooking(store, "r1", req())).toEqual({
      status: 201,
      body: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:30:00Z",
        end: "2026-11-02T10:00:00Z",
        attendees: 4,
      },
    });
    expect(handleCreateBooking(store, "r1", { kind: "invalid" })).toEqual({
      status: 400,
      body: { error: "invalid_json" },
    });
    expect(handleCreateBooking(store, "r1", req({ title: "" }))).toEqual({
      status: 400,
      body: { error: "invalid_booking" },
    });
    expect(handleCreateBooking(store, "r9", req())).toEqual({
      status: 404,
      body: { error: "room_not_found" },
    });
    expect(
      handleCreateBooking(store, "r1", req({ start: `${D}T09:45:00Z`, end: `${D}T10:30:00Z` })),
    ).toEqual({ status: 409, body: { error: "room_busy", conflictingBookingId: "b1" } });
    expect(handleCreateBooking(store, "r2", req({ attendees: 5 }))).toEqual({
      status: 422,
      body: { error: "over_capacity" },
    });
    // precedence
    expect(handleCreateBooking(store, "r2", req({ title: "", attendees: 5 })).status).toBe(400);
    expect(handleCreateBooking(store, "r9", { kind: "invalid" })).toEqual({
      status: 404,
      body: { error: "room_not_found" },
    });
  });

  it("attendees above the capacity win over an overlapping interval", () => {
    const store = createStore();
    store.addRoom("Alpha", 4);
    seed(store, "r1", "b1", 9, 10);
    const res = handleCreateBooking(
      store,
      "r1",
      req({ start: `${D}T09:30:00Z`, end: `${D}T10:30:00Z`, attendees: 5 }),
    );
    expect(res).toEqual({ status: 422, body: { error: "over_capacity" } });
  });

  it("attendees equal to a capacity of 10 and a title of 80 characters return 201", () => {
    const store = createStore();
    store.addRoom("Alpha", 10);
    const title = "y".repeat(80);
    const res = handleCreateBooking(store, "r1", req({ attendees: 10, title }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ attendees: 10, title });
  });

  // @covers room-booking-api:SCN-002
  it("a conflict in one room never blocks the same interval in another room and ids stay global", () => {
    const store = createStore();
    store.addRoom("Alpha", 4);
    store.addRoom("Beta", 4);
    const win = { start: `${D}T09:00:00Z`, end: `${D}T10:00:00Z`, attendees: 4 };
    expect(store.listBookings("r2", null)).toEqual([]);
    const first = handleCreateBooking(store, "r1", req(win));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ id: "b1" });
    const second = handleCreateBooking(store, "r1", req(win));
    expect(second).toEqual({ status: 409, body: { error: "room_busy", conflictingBookingId: "b1" } });
    const third = handleCreateBooking(store, "r2", req(win));
    expect(third.status).toBe(201);
    expect(third.body).toMatchObject({ id: "b2", roomId: "r2" });
    expect(store.listBookings("r2", null).map((b) => b.id)).toEqual(["b2"]);
    expect(store.listBookings("r1", null).map((b) => b.id)).toEqual(["b1"]);
  });
});
