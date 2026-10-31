import { describe, it, expect } from "vitest";
import { createBooking, deleteBooking } from "../../src/bookings/index.js";
import { createStore } from "../../src/store/index.js";
import type { Store } from "../../src/store/index.js";

const D = "2026-11-02T";
const body = (over: Record<string, unknown> = {}) => ({
  title: "Standup",
  start: `${D}09:00:00Z`,
  end: `${D}10:00:00Z`,
  attendees: 1,
  ...over,
});
const at = (s: string, e: string, over: Record<string, unknown> = {}) =>
  body({ start: `${D}${s}:00Z`, end: `${D}${e}:00Z`, ...over });

function withRoom(capacity = 10): Store {
  const store = createStore();
  store.rooms.create("Aurora", capacity);
  return store;
}
const count = (store: Store, roomId = "r1") => store.bookings.listByRoom(roomId).length;

describe("booking creation", () => {
  // @covers room-booking-api:BEH-006
  it("echoes the Booking with id b1 and the next id in another Room is b2", () => {
    const store = withRoom();
    store.rooms.create("Borealis", 10);
    const first = createBooking(store, "r1", {
      title: "Standup",
      start: `${D}09:30:00Z`,
      end: `${D}10:00:00Z`,
      attendees: 4,
    });
    expect(first).toEqual({
      ok: true,
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
    const second = createBooking(store, "r2", body({ title: "Review", attendees: 2 }));
    expect(second).toMatchObject({ ok: true, status: 201, body: { id: "b2", roomId: "r2" } });
  });

  it("accepts a title of exactly 80 characters", () => {
    const title = "0123456789".repeat(8);
    const res = createBooking(withRoom(), "r1", body({ title }));
    expect(res).toMatchObject({ ok: true, status: 201, body: { title } });
  });

  // @covers room-booking-api:BEH-007
  it.each([
    ["empty title", { title: "" }],
    ["whitespace-only title", { title: "   " }],
    ["81-character title", { title: "0123456789".repeat(8) + "0" }],
    ["unparseable start", { start: "tomorrow" }],
    ["second-precision start", { start: `${D}09:00:30Z` }],
    ["zero-length interval", { start: `${D}10:00:00Z`, end: `${D}10:00:00Z` }],
    ["reversed interval", { start: `${D}10:00:00Z`, end: `${D}09:00:00Z` }],
    ["8-hour-plus-one-minute interval", { start: `${D}09:00:00Z`, end: `${D}17:01:00Z` }],
  ])("rejects %s with invalid_booking and leaves the Room unchanged", (_n, over) => {
    const store = withRoom();
    const res = createBooking(store, "r1", body(over));
    expect(res).toEqual({ ok: false, code: "invalid_booking" });
    expect(count(store)).toBe(0);
  });

  it("accepts an interval of exactly 8 hours", () => {
    const res = createBooking(withRoom(), "r1", at("09:00", "17:00", { title: "Workshop", attendees: 2 }));
    expect(res).toMatchObject({ ok: true, status: 201, body: { end: "2026-11-02T17:00:00Z" } });
  });

  // @covers room-booking-api:BEH-008
  it("rejects an unknown Room with room_not_found and creates no Booking", () => {
    const store = withRoom();
    const res = createBooking(store, "r9", body());
    expect(res).toEqual({ ok: false, code: "room_not_found" });
    expect(count(store)).toBe(0);
    expect(count(store, "r9")).toBe(0);
  });

  it("answers room_not_found on an empty store", () => {
    expect(createBooking(createStore(), "r1", body())).toEqual({ ok: false, code: "room_not_found" });
  });

  it("accepts the same body for an existing Room", () => {
    expect(createBooking(withRoom(), "r1", body())).toMatchObject({ ok: true, status: 201, body: { id: "b1" } });
  });

  // @covers room-booking-api:BEH-009
  it("accepts attendees equal to capacity and rejects capacity plus one with over_capacity", () => {
    const store = withRoom(5);
    expect(createBooking(store, "r1", body({ attendees: 5 }))).toMatchObject({
      ok: true,
      status: 201,
      body: { attendees: 5 },
    });
    const res = createBooking(store, "r1", at("11:00", "12:00", { attendees: 6 }));
    expect(res).toEqual({ ok: false, code: "over_capacity" });
    expect(count(store)).toBe(1);
  });

  it.each([
    ["zero attendees", { attendees: 0 }],
    ["fractional attendees", { attendees: 1.5 }],
  ])("rejects %s with invalid_booking", (_n, over) => {
    expect(createBooking(withRoom(5), "r1", body(over))).toEqual({ ok: false, code: "invalid_booking" });
  });

  it("rejects absent attendees with invalid_booking", () => {
    const { attendees: _a, ...rest } = body();
    expect(createBooking(withRoom(5), "r1", rest)).toEqual({ ok: false, code: "invalid_booking" });
  });

  it("checks field validity before room existence", () => {
    expect(createBooking(createStore(), "r9", body({ title: "" }))).toEqual({ ok: false, code: "invalid_booking" });
  });

  it("checks capacity before overlap", () => {
    const store = withRoom(5);
    createBooking(store, "r1", body());
    expect(createBooking(store, "r1", body({ attendees: 6 }))).toEqual({ ok: false, code: "over_capacity" });
  });
});

describe("booking overlap", () => {
  function twoBookings(): Store {
    const store = withRoom();
    createBooking(store, "r1", at("09:00", "10:00"));
    createBooking(store, "r1", at("10:15", "11:15"));
    return store;
  }

  // @covers room-booking-api:BEH-010
  it("names the earliest-starting conflicting Booking", () => {
    const store = twoBookings();
    const res = createBooking(store, "r1", at("09:30", "10:30"));
    expect(res).toEqual({ ok: false, code: "room_busy", conflictingBookingId: "b1" });
    expect(count(store)).toBe(2);
  });

  it.each([
    ["containment", "09:15", "09:45", "b1"],
    ["full cover", "08:00", "11:30", "b1"],
    ["single conflict with the later Booking", "10:30", "11:00", "b2"],
  ])("reports room_busy for %s", (_n, s, e, id) => {
    expect(createBooking(twoBookings(), "r1", at(s, e))).toEqual({
      ok: false,
      code: "room_busy",
      conflictingBookingId: id,
    });
  });

  it("accepts an interval touching the end of one Booking and the start of the next", () => {
    const store = twoBookings();
    expect(createBooking(store, "r1", at("10:00", "10:15"))).toMatchObject({ ok: true, status: 201, body: { id: "b3" } });
    expect(count(store)).toBe(3);
  });

  it("accepts an interval touching the start of a Booking", () => {
    expect(createBooking(twoBookings(), "r1", at("08:00", "09:00"))).toMatchObject({ ok: true, status: 201 });
  });

  it("reports the earliest start even when the earlier-starting Booking has the higher id", () => {
    const store = withRoom();
    createBooking(store, "r1", at("09:30", "10:30"));
    createBooking(store, "r1", at("09:00", "09:30"));
    expect(createBooking(store, "r1", at("09:15", "10:00"))).toEqual({
      ok: false,
      code: "room_busy",
      conflictingBookingId: "b2",
    });
  });

  it("does not treat a Booking of another Room as a conflict", () => {
    const store = twoBookings();
    store.rooms.create("Borealis", 10);
    expect(createBooking(store, "r2", at("09:00", "10:00"))).toMatchObject({ ok: true, status: 201 });
  });
});

describe("booking deletion", () => {
  // @covers room-booking-api:BEH-014
  it("answers 204 without a body and frees the interval", () => {
    const store = withRoom();
    createBooking(store, "r1", at("09:00", "10:00"));
    const res = deleteBooking(store, "b1");
    expect(res).toEqual({ ok: true, status: 204, body: undefined });
    expect(count(store)).toBe(0);
    expect(createBooking(store, "r1", at("09:00", "10:00"))).toMatchObject({ ok: true, status: 201, body: { id: "b2" } });
  });

  it("answers booking_not_found for a repeated delete", () => {
    const store = withRoom();
    createBooking(store, "r1", at("09:00", "10:00"));
    deleteBooking(store, "b1");
    expect(deleteBooking(store, "b1")).toEqual({ ok: false, code: "booking_not_found" });
  });

  it("deletes a Booking of another Room and keeps the rest", () => {
    const store = withRoom();
    store.rooms.create("Borealis", 10);
    createBooking(store, "r1", at("09:00", "10:00"));
    createBooking(store, "r2", at("09:00", "10:00"));
    expect(deleteBooking(store, "b2")).toEqual({ ok: true, status: 204, body: undefined });
    expect(count(store, "r2")).toBe(0);
    expect(count(store, "r1")).toBe(1);
  });

  // @covers room-booking-api:BEH-015
  it("answers booking_not_found for an unknown id and changes nothing", () => {
    const store = withRoom();
    createBooking(store, "r1", at("09:00", "10:00"));
    expect(deleteBooking(store, "b7")).toEqual({ ok: false, code: "booking_not_found" });
    expect(count(store)).toBe(1);
  });

  it("answers booking_not_found on an empty store", () => {
    expect(deleteBooking(createStore(), "b7")).toEqual({ ok: false, code: "booking_not_found" });
  });

  it("deletes an existing id with 204", () => {
    const store = withRoom();
    createBooking(store, "r1", at("09:00", "10:00"));
    expect(deleteBooking(store, "b1")).toMatchObject({ ok: true, status: 204 });
  });
});

describe("booking contracts", () => {
  // @covers room-booking-api:CTR-003
  it("returns a b-prefixed id on success and the documented code per invalid class", () => {
    const store = withRoom();
    const ok = createBooking(store, "r1", body({ attendees: 4 }));
    expect(ok).toMatchObject({ ok: true, status: 201, body: { id: "b1", roomId: "r1", attendees: 4 } });
    expect(createBooking(store, "r1", at("11:00", "12:00", { attendees: 10 }))).toMatchObject({ ok: true, status: 201 });
    expect(createBooking(store, "r1", at("13:00", "14:00", { attendees: 11 }))).toEqual({ ok: false, code: "over_capacity" });
    expect(createBooking(store, "r1", at("09:30", "10:30", { attendees: 2 }))).toEqual({
      ok: false,
      code: "room_busy",
      conflictingBookingId: "b1",
    });
    expect(createBooking(store, "r1", at("10:00", "11:00", { attendees: 2 }))).toMatchObject({ ok: true, status: 201 });
    expect(createBooking(store, "r9", body())).toEqual({ ok: false, code: "room_not_found" });
    expect(createBooking(store, "r1", at("10:00", "09:00"))).toEqual({ ok: false, code: "invalid_booking" });
    expect(count(store)).toBe(3);
  });

  it("treats a non-object body as invalid_booking", () => {
    expect(createBooking(withRoom(), "r1", null)).toEqual({ ok: false, code: "invalid_booking" });
  });

  // @covers room-booking-api:CTR-005
  it("answers 204 for a known id and booking_not_found for unknown and repeated deletes", () => {
    const store = withRoom();
    createBooking(store, "r1", body());
    expect(deleteBooking(store, "b7")).toEqual({ ok: false, code: "booking_not_found" });
    expect(deleteBooking(store, "b1")).toEqual({ ok: true, status: 204, body: undefined });
    expect(deleteBooking(store, "b1")).toEqual({ ok: false, code: "booking_not_found" });
    expect(count(store)).toBe(0);
  });
});

describe("booking scenario", () => {
  // @covers room-booking-api:SCN-001
  it("books, conflicts, cancels and rebooks the same interval", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    const mk = () => createBooking(store, "r1", body({ attendees: 4 }));
    const first = mk();
    const retry = mk();
    const del = deleteBooking(store, "b1");
    const emptied = count(store);
    const final = mk();
    expect([first, retry, del, final].map((r) => (r.ok ? r.status : r.code))).toEqual([201, "room_busy", 204, 201]);
    expect(first).toMatchObject({ body: { id: "b1" } });
    expect(retry).toEqual({ ok: false, code: "room_busy", conflictingBookingId: "b1" });
    expect(del).toEqual({ ok: true, status: 204, body: undefined });
    expect(emptied).toBe(0);
    expect(final).toMatchObject({ ok: true, status: 201, body: { id: "b2", start: "2026-11-02T09:00:00Z", end: "2026-11-02T10:00:00Z" } });
  });
});
