import { describe, expect, it } from "vitest";
import { createStore, idNumber } from "../../src/store/index.js";

const booking = (roomId: string, title = "Sync") => ({
  roomId,
  title,
  start: "2026-11-02T09:00:00Z",
  end: "2026-11-02T10:00:00Z",
  attendees: 1,
});

describe("store ids", () => {
  // @covers room-booking-api:INV-001
  it("room ids are r1, r2 and booking ids share one counter across rooms and never reuse a deleted id", () => {
    const store = createStore();
    expect(store.rooms.create("Aurora", 6).id).toBe("r1");
    expect(store.rooms.create("Borealis", 2).id).toBe("r2");
    expect(store.bookings.create(booking("r1")).id).toBe("b1");
    expect(store.bookings.create(booking("r2")).id).toBe("b2");
    expect(store.bookings.remove("b1")).toBe(true);
    expect(store.bookings.create(booking("r1")).id).toBe("b3");
    expect(store.bookings.listByRoom("r1").map((b) => b.id)).toEqual(["b3"]);
  });

  it("created room echoes name and capacity", () => {
    const room = createStore().rooms.create("Cirrus", 3);
    expect(room).toEqual({ id: "r1", name: "Cirrus", capacity: 3 });
  });

  it("deleting the newest booking does not make its id reappear", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    store.bookings.create(booking("r1"));
    store.bookings.remove("b1");
    expect(store.bookings.create(booking("r1")).id).toBe("b2");
  });

  it.each([
    ["r1", 1],
    ["r12", 12],
    ["b3", 3],
    ["b10", 10],
  ])("id number of %s is %i", (id, n) => {
    expect(idNumber(id)).toBe(n);
  });
});

describe("store operations", () => {
  it("remove of an unknown booking id returns false and leaves the store unchanged", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    store.bookings.create(booking("r1"));
    expect(store.bookings.remove("b7")).toBe(false);
    expect(store.bookings.listByRoom("r1").map((b) => b.id)).toEqual(["b1"]);
  });

  it("removed booking is no longer found", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    store.bookings.create(booking("r1"));
    store.bookings.remove("b1");
    expect(store.bookings.get("b1")).toBeUndefined();
  });

  it("listByRoom returns only that room's bookings in creation order", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    store.rooms.create("Borealis", 2);
    store.bookings.create(booking("r1", "first"));
    store.bookings.create(booking("r2", "other"));
    store.bookings.create(booking("r1", "second"));
    expect(store.bookings.listByRoom("r1").map((b) => b.title)).toEqual(["first", "second"]);
    expect(store.bookings.listByRoom("r1").map((b) => b.id)).toEqual(["b1", "b3"]);
  });

  it("rooms list in creation order and get returns the stored room", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    store.rooms.create("Borealis", 2);
    expect(store.rooms.list().map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(store.rooms.get("r2")).toEqual({ id: "r2", name: "Borealis", capacity: 2 });
    expect(store.rooms.get("r9")).toBeUndefined();
  });

  it("findByNameIgnoringCase matches a differently cased name", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    expect(store.rooms.findByNameIgnoringCase("AURORA")?.id).toBe("r1");
    expect(store.rooms.findByNameIgnoringCase("Borealis")).toBeUndefined();
  });
});

describe("store lives only in memory", () => {
  // @covers room-booking-api:INV-004
  it("a freshly created store is empty and does not see rooms of an earlier store", () => {
    const first = createStore();
    expect(first.rooms.list()).toEqual([]);
    first.rooms.create("Aurora", 6);
    expect(first.rooms.list().map((r) => r.id)).toEqual(["r1"]);
    const second = createStore();
    expect(second.rooms.list()).toEqual([]);
    expect(second.rooms.get("r1")).toBeUndefined();
    expect(second.rooms.create("Aurora", 6).id).toBe("r1");
  });
});
