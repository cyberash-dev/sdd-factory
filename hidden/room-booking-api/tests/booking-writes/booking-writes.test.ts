import { describe, expect, it } from "vitest";
import { addBooking, addRoom, createStore } from "../../src/domain/index.js";
import type { Store } from "../../src/domain/index.js";
import { createBooking, deleteBooking } from "../../src/booking-writes/index.js";

const day = "2026-11-02";
const t = (hhmm: string) => `${day}T${hhmm}:00Z`;

function body(start: string, end: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Standup", start: t(start), end: t(end), attendees: 1, ...extra };
}

function withRooms(...capacities: number[]): Store {
  const store = createStore();
  capacities.forEach((c, i) => addRoom(store, `Room${i + 1}`, c));
  return store;
}

const fail = (code: string, extra: Record<string, unknown> = {}) => ({
  ok: false,
  error: { code, ...extra },
});

describe("POST /rooms/:roomId/bookings createBooking", () => {
  // @covers room-booking-api:BEH-006
  it("a valid booking body in room r1 returns the booking b1 and the booking is listed", () => {
    const store = withRooms(10);
    const res = createBooking(store, "r1", {
      title: "Standup",
      start: "2026-11-02T09:00:00Z",
      end: "2026-11-02T09:30:00Z",
      attendees: 6,
    });
    const expected = {
      id: "b1",
      roomId: "r1",
      title: "Standup",
      start: "2026-11-02T09:00:00Z",
      end: "2026-11-02T09:30:00Z",
      attendees: 6,
    };
    expect(res).toEqual({ ok: true, value: expected });
    expect(store.bookings).toEqual([expected]);
  });

  it("a later booking in room r1 gets the next booking id b2", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("09:00", "09:30"));
    const res = createBooking(store, "r1", body("10:00", "10:30"));
    expect(res).toEqual({
      ok: true,
      value: { id: "b2", roomId: "r1", title: "Standup", start: t("10:00"), end: t("10:30"), attendees: 1 },
    });
    expect(store.bookings.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it.each([1, 10])("attendees %i against capacity 10 is echoed in the created booking", (n) => {
    const store = withRooms(10);
    const res = createBooking(store, "r1", body("09:00", "09:30", { attendees: n }));
    expect(res).toEqual({
      ok: true,
      value: { id: "b1", roomId: "r1", title: "Standup", start: t("09:00"), end: t("09:30"), attendees: n },
    });
  });

  it("attendees 11 with room capacity 10 is over_capacity and not created", () => {
    const store = withRooms(10);
    expect(createBooking(store, "r1", body("09:00", "09:30", { attendees: 11 }))).toEqual(fail("over_capacity"));
    expect(store.bookings).toEqual([]);
  });

  it("unknown fields in the booking body are ignored", () => {
    const store = withRooms(10);
    const res = createBooking(store, "r1", body("09:00", "09:30", { color: "red" }));
    expect(res).toEqual({
      ok: true,
      value: { id: "b1", roomId: "r1", title: "Standup", start: t("09:00"), end: t("09:30"), attendees: 1 },
    });
  });

  it("a title is trimmed before it is stored", () => {
    const store = withRooms(10);
    const res = createBooking(store, "r1", body("09:00", "09:30", { title: "  Standup  " }));
    expect(res).toEqual({
      ok: true,
      value: { id: "b1", roomId: "r1", title: "Standup", start: t("09:00"), end: t("09:30"), attendees: 1 },
    });
  });

  // @covers room-booking-api:BEH-007
  it("a booking for unknown room r99 is room_not_found and creates nothing while r1 accepts the same body", () => {
    const store = withRooms(10);
    expect(createBooking(store, "r99", body("09:00", "09:30"))).toEqual(fail("room_not_found"));
    expect(store.bookings).toEqual([]);
    expect(createBooking(store, "r1", body("09:00", "09:30"))).toMatchObject({ ok: true });
  });

  it("a non-numeric room id room-99 is room_not_found", () => {
    const store = withRooms(10);
    expect(createBooking(store, "room-99", body("09:00", "09:30"))).toEqual(fail("room_not_found"));
    expect(store.bookings).toEqual([]);
  });

  it("an unknown room is reported before an invalid booking field", () => {
    const store = withRooms(10);
    expect(createBooking(store, "r99", { title: "" })).toEqual(fail("room_not_found"));
  });

  // @covers room-booking-api:BEH-008
  it.each([
    ["empty title", { title: "" }],
    ["whitespace title", { title: "   " }],
    ["81-character title", { title: "a".repeat(81) }],
    ["non-string title", { title: 5 }],
    ["missing title", { title: undefined }],
    ["start without the Z suffix", { start: "2026-11-02T09:30:00", end: t("10:00") }],
    ["start with an offset", { start: "2026-11-02T09:30:00+00:00", end: t("10:00") }],
    ["start with seconds", { start: "2026-11-02T09:30:30Z", end: t("10:00") }],
    ["start with milliseconds", { start: "2026-11-02T09:30:00.500Z", end: t("10:00") }],
    ["unparsable start", { start: "not-a-time", end: t("10:00") }],
    ["end equal to start", { start: t("09:00"), end: t("09:00") }],
    ["end before start", { start: t("10:00"), end: t("09:59") }],
    ["duration 8 hours plus one minute", { start: t("09:00"), end: t("17:01") }],
    ["attendees 0", { attendees: 0 }],
    ["non-integer attendees", { attendees: 1.5 }],
    ["string attendees", { attendees: "2" }],
    ["missing attendees", { attendees: undefined }],
  ])("%s is invalid_booking and creates no booking", (_name, patch) => {
    const store = withRooms(10);
    const res = createBooking(store, "r1", { ...body("09:00", "09:30"), ...patch });
    expect(res).toEqual(fail("invalid_booking"));
    expect(store.bookings).toEqual([]);
  });

  it.each([
    ["an 80-character title", { title: "a".repeat(80) }],
    ["a duration of exactly 8 hours", { start: t("09:00"), end: t("17:00") }],
  ])("%s is accepted at the inclusive boundary", (_name, patch) => {
    const store = withRooms(10);
    const res = createBooking(store, "r1", { ...body("09:00", "09:30"), ...patch });
    expect(res).toMatchObject({ ok: true, value: { id: "b1", roomId: "r1" } });
    expect(store.bookings).toHaveLength(1);
  });

  // @covers room-booking-api:BEH-009
  it("attendees 5 with capacity 4 is over_capacity and attendees 4 is created", () => {
    const store = withRooms(10, 4);
    expect(createBooking(store, "r2", body("09:00", "09:30", { attendees: 5 }))).toEqual(fail("over_capacity"));
    expect(store.bookings).toEqual([]);
    const ok = createBooking(store, "r2", body("09:00", "09:30", { attendees: 4 }));
    expect(ok).toEqual({
      ok: true,
      value: { id: "b1", roomId: "r2", title: "Standup", start: t("09:00"), end: t("09:30"), attendees: 4 },
    });
    expect(store.bookings).toHaveLength(1);
  });

  it("attendees 0 against capacity 4 is invalid_booking and not over_capacity", () => {
    const store = withRooms(10, 4);
    expect(createBooking(store, "r2", body("09:00", "09:30", { attendees: 0 }))).toEqual(fail("invalid_booking"));
  });

  // @covers room-booking-api:BEH-010
  it("an interval overlapping b1 is room_busy naming b1 and creates nothing", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    createBooking(store, "r1", body("11:00", "12:00"));
    const res = createBooking(store, "r1", body("10:30", "11:30"));
    expect(res).toEqual(fail("room_busy", { conflictingBookingId: "b1" }));
    expect(store.bookings.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("an interval spanning b1 and b2 names the earliest-starting conflict b1", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    createBooking(store, "r1", body("11:00", "12:00"));
    expect(createBooking(store, "r1", body("09:30", "12:30"))).toEqual(
      fail("room_busy", { conflictingBookingId: "b1" }),
    );
  });

  it("the earliest-starting conflict is named even when it has the higher booking id", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("11:00", "12:00"));
    createBooking(store, "r1", body("10:00", "11:00"));
    expect(createBooking(store, "r1", body("09:30", "12:30"))).toEqual(
      fail("room_busy", { conflictingBookingId: "b2" }),
    );
  });

  it("the same overlapping interval in another room with free capacity is created", () => {
    const store = withRooms(10, 10);
    createBooking(store, "r1", body("10:00", "11:00"));
    const res = createBooking(store, "r2", body("10:30", "11:30"));
    expect(res).toMatchObject({ ok: true, value: { id: "b2", roomId: "r2" } });
  });

  it("an interval starting at the end of the last booking is created", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    createBooking(store, "r1", body("11:00", "12:00"));
    expect(createBooking(store, "r1", body("12:00", "12:30"))).toMatchObject({ ok: true, value: { id: "b3" } });
  });

  it("an over-capacity request that also overlaps is over_capacity and not room_busy", () => {
    const store = withRooms(4);
    createBooking(store, "r1", body("10:00", "11:00"));
    expect(createBooking(store, "r1", body("10:30", "11:30", { attendees: 5 }))).toEqual(fail("over_capacity"));
  });

  // @covers room-booking-api:BEH-011
  it("intervals touching b1 at its start and at its end are created and listed", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    expect(createBooking(store, "r1", body("11:00", "11:30"))).toMatchObject({ ok: true, value: { id: "b2" } });
    expect(createBooking(store, "r1", body("09:30", "10:00"))).toMatchObject({ ok: true, value: { id: "b3" } });
    expect(store.bookings.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it.each([
    ["10:59", "11:30"],
    ["09:30", "10:01"],
  ])("an interval %s to %s sharing one minute with b1 is room_busy naming b1", (s, e) => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    expect(createBooking(store, "r1", body(s, e))).toEqual(fail("room_busy", { conflictingBookingId: "b1" }));
    expect(store.bookings).toHaveLength(1);
  });

  // @covers room-booking-api:CTR-004
  it("createBooking answers one typed outcome per input class", () => {
    const store = withRooms(10);
    expect(
      createBooking(store, "r1", {
        title: "Standup",
        start: "2026-11-02T09:00:00Z",
        end: "2026-11-02T09:30:00Z",
        attendees: 6,
      }),
    ).toEqual({
      ok: true,
      value: {
        id: "b1",
        roomId: "r1",
        title: "Standup",
        start: "2026-11-02T09:00:00Z",
        end: "2026-11-02T09:30:00Z",
        attendees: 6,
      },
    });
    expect(createBooking(store, "r99", body("12:00", "12:30"))).toEqual(fail("room_not_found"));
    expect(createBooking(store, "r1", body("12:00", "12:30", { title: "" }))).toEqual(fail("invalid_booking"));
    expect(createBooking(store, "r1", body("12:00", "12:30", { attendees: 11 }))).toEqual(fail("over_capacity"));
    expect(createBooking(store, "r1", body("09:00", "10:00"))).toEqual(
      fail("room_busy", { conflictingBookingId: "b1" }),
    );
    expect(store.bookings).toHaveLength(1);
  });
});

describe("DELETE /bookings/:bookingId deleteBooking", () => {
  // @covers room-booking-api:BEH-015
  it("deleting the only booking b1 returns an empty success, unlists it and frees the interval", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    expect(deleteBooking(store, "b1")).toEqual({ ok: true, value: null });
    expect(store.bookings).toEqual([]);
    const again = createBooking(store, "r1", body("10:00", "11:00"));
    expect(again).toMatchObject({ ok: true, value: { roomId: "r1", start: t("10:00"), end: t("11:00") } });
  });

  it("deleting b1 a second time is booking_not_found", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    deleteBooking(store, "b1");
    expect(deleteBooking(store, "b1")).toEqual(fail("booking_not_found"));
  });

  // @covers room-booking-api:BEH-016
  it("deleting unknown booking b99 is booking_not_found and leaves b1 listed", () => {
    const store = withRooms(10);
    createBooking(store, "r1", body("10:00", "11:00"));
    const before = [...store.bookings];
    expect(deleteBooking(store, "b99")).toEqual(fail("booking_not_found"));
    expect(store.bookings).toEqual(before);
    expect(deleteBooking(store, "b1")).toEqual({ ok: true, value: null });
  });

  it("deleting an id that was never a booking id is booking_not_found", () => {
    const store = withRooms(10);
    expect(deleteBooking(store, "r1")).toEqual(fail("booking_not_found"));
  });

  // @covers room-booking-api:CTR-006
  it("deleteBooking answers null for a known booking and booking_not_found for an unknown one", () => {
    const store = withRooms(10);
    addBooking(store, "r1", { title: "Standup", start: t("10:00"), end: t("11:00"), attendees: 1 });
    expect(deleteBooking(store, "b99")).toEqual(fail("booking_not_found"));
    expect(deleteBooking(store, "b1")).toEqual({ ok: true, value: null });
    expect(store.bookings).toEqual([]);
  });
});

describe("booking scenarios", () => {
  // @covers room-booking-api:SCN-001
  it("book, conflict, release and rebook one room interval", () => {
    const store = createStore();
    addRoom(store, "Aurora", 4);
    expect(createBooking(store, "r1", body("10:00", "11:00"))).toMatchObject({ ok: true, value: { id: "b1" } });
    expect(createBooking(store, "r1", body("10:30", "11:30"))).toEqual(
      fail("room_busy", { conflictingBookingId: "b1" }),
    );
    expect(store.bookings.map((b) => b.id)).toEqual(["b1"]);
    expect(deleteBooking(store, "b1")).toEqual({ ok: true, value: null });
    expect(store.bookings).toEqual([]);
    const again = createBooking(store, "r1", body("10:00", "11:00"));
    expect(again).toMatchObject({ ok: true, value: { id: "b2", roomId: "r1" } });
    expect(store.bookings).toHaveLength(1);
  });

  // @covers room-booking-api:SCN-002
  it("booking ids follow creation order across rooms, are not reused after a delete and room ids continue", () => {
    const store = withRooms(4, 4);
    const first = createBooking(store, "r1", body("09:00", "09:30"));
    const second = createBooking(store, "r2", body("09:00", "09:30"));
    expect(first).toMatchObject({ ok: true, value: { id: "b1", roomId: "r1" } });
    expect(second).toMatchObject({ ok: true, value: { id: "b2", roomId: "r2" } });
    expect(deleteBooking(store, "b1")).toEqual({ ok: true, value: null });
    expect(createBooking(store, "r1", body("11:00", "11:30"))).toMatchObject({
      ok: true,
      value: { id: "b3", roomId: "r1" },
    });
    expect(addRoom(store, "Borealis", 4).id).toBe("r3");
    expect(store.rooms.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });
});
