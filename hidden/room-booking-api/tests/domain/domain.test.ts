import { describe, expect, it } from "vitest";
import {
  addBooking,
  addRoom,
  compareIds,
  createStore,
  findRoom,
  overlaps,
  removeBooking,
} from "../../src/domain/index.js";

const f = (start: string, end: string, attendees = 2) => ({ title: "t", start, end, attendees });

describe("store", () => {
  // @covers room-booking-api:INV-001
  it("Room ids are r1 to r12 in creation order without gaps or duplicates", () => {
    const store = createStore();
    const ids = Array.from({ length: 12 }, (_, i) => addRoom(store, `Room${i}`, 4).id);
    expect(ids).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12"]);
    expect(store.rooms.map((r) => r.id)).toEqual(ids);
  });

  it("a new store holds no rooms and no bookings", () => {
    const store = createStore();
    expect(store.rooms).toEqual([]);
    expect(store.bookings).toEqual([]);
  });

  it("compareIds orders r10 after r9 numerically", () => {
    expect(compareIds("r9", "r10")).toBeLessThan(0);
    expect(compareIds("r10", "r9")).toBeGreaterThan(0);
    expect(compareIds("r2", "r2")).toBe(0);
  });

  it("findRoom returns the stored room or undefined", () => {
    const store = createStore();
    addRoom(store, "Aurora", 4);
    expect(findRoom(store, "r1")).toEqual({ id: "r1", name: "Aurora", capacity: 4 });
    expect(findRoom(store, "r9")).toBeUndefined();
  });

  // @covers room-booking-api:INV-002
  it("Booking ids are one counter across rooms and a deleted id is never reused", () => {
    const store = createStore();
    addRoom(store, "Aurora", 4);
    addRoom(store, "Borealis", 4);
    const first = addBooking(store, "r1", f("2026-11-01T10:00Z", "2026-11-01T11:00Z"));
    const second = addBooking(store, "r2", f("2026-11-01T10:00Z", "2026-11-01T11:00Z"));
    expect([first.id, second.id]).toEqual(["b1", "b2"]);
    expect(removeBooking(store, "b1")).toBe(true);
    expect(removeBooking(store, "b1")).toBe(false);
    const third = addBooking(store, "r1", f("2026-11-01T10:00Z", "2026-11-01T11:00Z"));
    expect(third.id).toBe("b3");
  });

  // @covers room-booking-api:INV-003
  it("overlap predicate is half-open so adjacent intervals do not overlap", () => {
    expect(overlaps("2026-11-01T10:00Z", "2026-11-01T11:00Z", "2026-11-01T10:30Z", "2026-11-01T11:30Z")).toBe(true);
    expect(overlaps("2026-11-01T10:30Z", "2026-11-01T11:30Z", "2026-11-01T10:00Z", "2026-11-01T11:00Z")).toBe(true);
    expect(overlaps("2026-11-01T10:00Z", "2026-11-01T11:00Z", "2026-11-01T11:00Z", "2026-11-01T11:30Z")).toBe(false);
    expect(overlaps("2026-11-01T11:00Z", "2026-11-01T11:30Z", "2026-11-01T10:00Z", "2026-11-01T11:00Z")).toBe(false);
  });

  // @covers room-booking-api:INV-004
  it("a booking with attendees equal to capacity is stored and room capacity is unchanged", () => {
    const store = createStore();
    addRoom(store, "Aurora", 4);
    const booking = addBooking(store, "r1", f("2026-11-01T10:00Z", "2026-11-01T11:00Z", 4));
    expect(booking).toMatchObject({ id: "b1", roomId: "r1", attendees: 4 });
    expect(store.bookings).toHaveLength(1);
    expect(store.bookings[0]?.attendees).toBe(4);
    expect(findRoom(store, "r1")?.capacity).toBe(4);
  });
});
