import { describe, expect, it } from "vitest";
import { createStore, intervalsOverlap, parseTime } from "../../src/core/index.js";
import type { NewBooking } from "../../src/core/index.js";

const MS_0900 = 1793610000000;
const MS_0930 = 1793611800000;
const MS_1000 = 1793613600000;
const MS_1030 = 1793615400000;
const MS_1100 = 1793617200000;

const S_0900 = "2026-11-02T09:00:00Z";
const S_1000 = "2026-11-02T10:00:00Z";
const S_1100 = "2026-11-02T11:00:00Z";

function booking(roomId: string, start: string, end: string, startMs: number, endMs: number): NewBooking {
  return { roomId, title: "Sync", start, end, startMs, endMs, attendees: 2 };
}

const nine = (roomId: string): NewBooking => booking(roomId, S_0900, S_1000, MS_0900, MS_1000);
const ten = (roomId: string): NewBooking => booking(roomId, S_1000, S_1100, MS_1000, MS_1100);

describe("room ids (INV-001)", () => {
  // @covers room-booking-api:INV-001
  it("hands out room ids r1..r10 in creation order and never r0", () => {
    const store = createStore();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(store.addRoom(`Room ${i}`, 10).id);
    expect(ids).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"]);
    expect(store.listRooms(null).map((r) => r.id)).toEqual(ids);
  });

  it("lists no room on an empty store and finds none by id", () => {
    const store = createStore();
    expect(store.listRooms(null)).toEqual([]);
    expect(store.findRoom("r1")).toBeNull();
  });

  it("keeps the first room when a second room is created", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addRoom("Studio", 4);
    expect(store.findRoom("r1")).toEqual({ id: "r1", name: "Lab", capacity: 10 });
    expect(store.findRoom("r2")).toEqual({ id: "r2", name: "Studio", capacity: 4 });
  });

  it("orders rooms by the integer suffix of the id, r10 after r9", () => {
    const store = createStore();
    for (let i = 0; i < 10; i++) store.addRoom(`Room ${i}`, 5);
    const ids = store.listRooms(null).map((r) => r.id);
    expect(ids[8]).toBe("r9");
    expect(ids[9]).toBe("r10");
  });

  it("filters rooms by minimum capacity", () => {
    const store = createStore();
    store.addRoom("Small", 2);
    store.addRoom("Big", 10);
    expect(store.listRooms(5).map((r) => r.id)).toEqual(["r2"]);
    expect(store.listRooms(10).map((r) => r.id)).toEqual(["r2"]);
    expect(store.listRooms(11)).toEqual([]);
  });

  it("reports a taken room name", () => {
    const store = createStore();
    expect(store.roomNameTaken("Lab")).toBe(false);
    store.addRoom("Lab", 10);
    expect(store.roomNameTaken("Lab")).toBe(true);
  });
});

describe("booking ids (INV-002)", () => {
  // @covers room-booking-api:INV-002
  it("hands out booking ids b1, b2 in room r1 and b3 in a second room", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addRoom("Studio", 10);
    expect(store.addBooking(nine("r1")).id).toBe("b1");
    expect(store.addBooking(ten("r1")).id).toBe("b2");
    expect(store.addBooking(nine("r2")).id).toBe("b3");
  });

  it("gives the first booking of a second room b2, never b1", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addRoom("Studio", 10);
    store.addBooking(nine("r1"));
    expect(store.addBooking(nine("r2")).id).toBe("b2");
  });

  it("never hands out b1 again after booking b1 is deleted", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(nine("r1"));
    expect(store.deleteBooking("b1")).toEqual({
      id: "b1",
      roomId: "r1",
      title: "Sync",
      start: S_0900,
      end: S_1000,
      attendees: 2,
    });
    expect(store.findBooking("b1")).toBeNull();
    expect(store.addBooking(nine("r1")).id).toBe("b2");
  });

  it("never hands out the id of the highest deleted booking again", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(nine("r1"));
    store.addBooking(ten("r1"));
    store.deleteBooking("b2");
    expect(store.addBooking(ten("r1")).id).toBe("b3");
  });

  it("returns null when deleting a booking that does not exist", () => {
    const store = createStore();
    expect(store.deleteBooking("b1")).toBeNull();
  });

  it("hands out b10 as the tenth booking across ten rooms", () => {
    const store = createStore();
    for (let i = 0; i < 10; i++) store.addRoom(`Room ${i}`, 10);
    for (let i = 1; i <= 10; i++) store.addBooking(nine(`r${i}`));
    const ids: string[] = [];
    for (let i = 1; i <= 10; i++) ids.push(...store.listBookings(`r${i}`, null).map((b) => b.id));
    expect(ids).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10"]);
  });
});

describe("overlap rule (INV-003)", () => {
  // @covers room-booking-api:INV-003
  it("stores a booking ending exactly at another start alongside it", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(nine("r1"));
    expect(store.earliestConflict("r1", { startMs: MS_1000, endMs: MS_1100 })).toBeNull();
    store.addBooking(ten("r1"));
    expect(store.listBookings("r1", null).map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it.each([
    { name: "touching end to start", a: [MS_0900, MS_1000], b: [MS_1000, MS_1100], expected: false },
    { name: "touching start to end", a: [MS_1000, MS_1100], b: [MS_0900, MS_1000], expected: false },
    { name: "disjoint", a: [MS_0900, MS_0930], b: [MS_1000, MS_1100], expected: false },
    { name: "nested", a: [MS_0900, MS_1100], b: [MS_0930, MS_1030], expected: true },
    { name: "identical", a: [MS_0900, MS_1000], b: [MS_0900, MS_1000], expected: true },
    { name: "partial overlap", a: [MS_0900, MS_1000], b: [MS_0930, MS_1030], expected: true },
  ])("intervalsOverlap on half-open intervals: $name", ({ a, b, expected }) => {
    expect(intervalsOverlap({ startMs: a[0]!, endMs: a[1]! }, { startMs: b[0]!, endMs: b[1]! })).toBe(expected);
  });

  it("reports the booking that a nested interval conflicts with", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(booking("r1", S_0900, S_1100, MS_0900, MS_1100));
    const conflict = store.earliestConflict("r1", { startMs: MS_0930, endMs: MS_1030 });
    expect(conflict?.id).toBe("b1");
    expect(store.listBookings("r1", null)).toHaveLength(1);
  });

  it("stores the identical interval independently in two rooms", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addRoom("Studio", 10);
    store.addBooking(nine("r1"));
    expect(store.earliestConflict("r2", { startMs: MS_0900, endMs: MS_1000 })).toBeNull();
    store.addBooking(nine("r2"));
    expect(store.listBookings("r1", null)).toHaveLength(1);
    expect(store.listBookings("r2", null)).toHaveLength(1);
  });

  it("lists no booking for a room that holds none", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    expect(store.listBookings("r1", null)).toEqual([]);
  });

  it("returns the conflict with the smallest start, then the smallest id suffix", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(ten("r1"));
    store.addBooking(nine("r1"));
    expect(store.earliestConflict("r1", { startMs: MS_0900, endMs: MS_1100 })?.id).toBe("b2");
  });

  it("orders bookings of a room by start ascending", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(ten("r1"));
    store.addBooking(nine("r1"));
    expect(store.listBookings("r1", null).map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  it("keeps only bookings overlapping the half-open window", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(nine("r1"));
    store.addBooking(ten("r1"));
    expect(store.listBookings("r1", { startMs: MS_1000, endMs: MS_1100 }).map((b) => b.id)).toEqual(["b2"]);
    expect(store.listBookings("r1", { startMs: MS_1100, endMs: MS_1100 + 60000 })).toEqual([]);
  });

  it("excludes a room with a conflicting booking from availability", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addRoom("Studio", 10);
    store.addBooking(nine("r1"));
    expect(store.availableRooms({ startMs: MS_0930, endMs: MS_1030 }, 5).map((r) => r.id)).toEqual(["r2"]);
    expect(store.availableRooms({ startMs: MS_1000, endMs: MS_1100 }, 5).map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("response object key sets (INV-007)", () => {
  // @covers room-booking-api:INV-007
  it("holds exactly id, name and capacity in a room and the six booking fields in a booking", () => {
    const store = createStore();
    const room = store.addRoom("Lab", 10);
    expect(Object.keys(room).sort()).toEqual(["capacity", "id", "name"]);
    const created = store.addBooking(nine("r1"));
    expect(Object.keys(created).sort()).toEqual(["attendees", "end", "id", "roomId", "start", "title"]);
    expect(Object.keys(store.listRooms(null)[0]!).sort()).toEqual(["capacity", "id", "name"]);
    expect(Object.keys(store.listBookings("r1", null)[0]!).sort()).toEqual([
      "attendees",
      "end",
      "id",
      "roomId",
      "start",
      "title",
    ]);
  });

  it("carries attendees and roomId on a booking found by id", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addBooking(nine("r1"));
    expect(store.findBooking("b1")).toEqual({
      id: "b1",
      roomId: "r1",
      title: "Sync",
      start: S_0900,
      end: S_1000,
      attendees: 2,
    });
  });
});

describe("UTC whole-minute times (INV-008)", () => {
  // @covers room-booking-api:INV-008
  it("parseTime accepts the three whole-minute forms of 09:30 and returns epoch milliseconds", () => {
    expect(parseTime("2026-11-02T09:30:00Z")).toBe(MS_0930);
    expect(parseTime("2026-11-02T09:30Z")).toBe(MS_0930);
    expect(parseTime("2026-11-02T09:30:00.000Z")).toBe(MS_0930);
  });

  it("parseTime rejects off-minute, offset, lower-case, non-calendar and malformed spellings", () => {
    const rejected = [
      "2026-11-02T09:30:45Z",
      "2026-11-02T10:30:00+01:00",
      "2026-11-02T09:30:00z",
      "2026-11-02T09:30:00.500Z",
      "2026-11-02T09:30:00",
      "2026-11-02T09:30:00.0Z",
      "2026-02-30T09:30:00Z",
      "2026-13-02T09:30:00Z",
      "2026-11-02T24:00:00Z",
      "2026-11-02",
      "",
      "not a time",
    ];
    for (const value of rejected) expect(parseTime(value), value).toBeNull();
  });

  it("returns the start and end spelling the requester sent", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    const created = store.addBooking(booking("r1", "2026-11-02T09:30Z", "2026-11-02T10:00:00.000Z", MS_0930, MS_1000));
    expect(created.start).toBe("2026-11-02T09:30Z");
    expect(created.end).toBe("2026-11-02T10:00:00.000Z");
    expect(store.listBookings("r1", null)[0]).toMatchObject({
      start: "2026-11-02T09:30Z",
      end: "2026-11-02T10:00:00.000Z",
    });
  });
});
