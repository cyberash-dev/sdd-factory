import { describe, it, expect, vi } from "vitest";

async function load() {
  vi.resetModules();
  return await import("../../src/state/index.js");
}

const D = "2026-11-02T";
const ms = (t: string) => Date.parse(`${D}${t}Z`);

describe("room and booking ids", () => {
  // @covers room-booking-api:INV-001
  it("assigns r1, r2 to rooms and b1, b2 to bookings across rooms, never reusing b1 after a removal", async () => {
    const s = await load();
    expect(s.listRooms()).toEqual([]);
    const r1 = s.addRoom("Aurora", 8);
    const r2 = s.addRoom("Borealis", 4);
    const r3 = s.addRoom("Cirrus", 2);
    expect([r1.id, r2.id, r3.id]).toEqual(["r1", "r2", "r3"]);
    const b1 = s.addBooking("r1", "a", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    const b2 = s.addBooking("r2", "b", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    const b3 = s.addBooking("r3", "c", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect([b1.id, b2.id, b3.id]).toEqual(["b1", "b2", "b3"]);
    expect(s.removeBooking("b1")).toBe(true);
    const b4 = s.addBooking("r1", "d", `${D}11:00:00Z`, `${D}12:00:00Z`, 1);
    expect(b4.id).toBe("b4");
    expect(s.addRoom("Dune", 3).id).toBe("r4");
  });

  it("keeps the room counter and the booking counter independent", async () => {
    const s = await load();
    s.addRoom("A", 1);
    expect(s.addBooking("r1", "t", `${D}09:00:00Z`, `${D}10:00:00Z`, 1).id).toBe("b1");
    expect(s.addRoom("B", 1).id).toBe("r2");
  });

  it("reports false when removing an unknown or already removed booking", async () => {
    const s = await load();
    s.addRoom("A", 1);
    s.addBooking("r1", "t", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(s.removeBooking("b1")).toBe(true);
    expect(s.removeBooking("b1")).toBe(false);
    expect(s.removeBooking("b99")).toBe(false);
    expect(s.findBooking("b1")).toBeUndefined();
  });

  it("finds a room and a booking by id and returns undefined for unknown ids", async () => {
    const s = await load();
    s.addRoom("A", 1);
    s.addBooking("r1", "t", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(s.findRoom("r1")?.name).toBe("A");
    expect(s.findRoom("r2")).toBeUndefined();
    expect(s.findBooking("b1")?.roomId).toBe("r1");
    expect(s.findBooking("b2")).toBeUndefined();
  });
});

describe("half-open booking interval", () => {
  async function seeded() {
    const s = await load();
    s.addRoom("A", 8);
    s.addBooking("r1", "t", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    return s;
  }

  // @covers room-booking-api:INV-002
  it("does not count a window that starts at a booking end or ends at a booking start as overlapping", async () => {
    const s = await seeded();
    expect(s.overlappingBookings("r1", ms("10:00:00"), ms("10:30:00"))).toEqual([]);
    expect(s.overlappingBookings("r1", ms("08:00:00"), ms("09:00:00"))).toEqual([]);
  });

  it("counts a one-minute overlap as overlapping", async () => {
    const s = await seeded();
    expect(s.overlappingBookings("r1", ms("09:59:00"), ms("10:30:00")).map((b) => b.id)).toEqual(["b1"]);
    expect(s.overlappingBookings("r1", ms("08:00:00"), ms("09:01:00")).map((b) => b.id)).toEqual(["b1"]);
  });

  it("returns nothing for an empty schedule and ignores bookings of other rooms", async () => {
    const s = await seeded();
    s.addRoom("B", 8);
    expect(s.overlappingBookings("r2", ms("09:00:00"), ms("10:00:00"))).toEqual([]);
  });

  it("returns overlapping bookings in start order then id order", async () => {
    const s = await load();
    s.addRoom("A", 8);
    s.addBooking("r1", "late", `${D}11:00:00Z`, `${D}12:00:00Z`, 1);
    s.addBooking("r1", "early", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(s.overlappingBookings("r1", ms("08:00:00"), ms("13:00:00")).map((b) => b.id)).toEqual(["b2", "b1"]);
  });
});

describe("in-memory store after a restart", () => {
  // @covers room-booking-api:INV-005
  it("starts a restarted process with no rooms and no bookings and assigns r1 and b1 again", async () => {
    const s1 = await load();
    s1.addRoom("Aurora", 8);
    s1.addBooking("r1", "t", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(s1.listRooms()).toHaveLength(1);
    const s2 = await load();
    expect(s2.listRooms()).toEqual([]);
    expect(s2.findRoom("r1")).toBeUndefined();
    expect(s2.findBooking("b1")).toBeUndefined();
    expect(s2.listBookingsOfRoom("r1")).toEqual([]);
    expect(s2.addRoom("Aurora", 8).id).toBe("r1");
    expect(s2.addBooking("r1", "t", `${D}09:00:00Z`, `${D}10:00:00Z`, 1).id).toBe("b1");
  });
});

describe("ordering by id", () => {
  // @covers room-booking-api:INV-007
  it("lists eleven rooms with r2 before r10 in creation order", async () => {
    const s = await load();
    for (let i = 1; i <= 11; i++) s.addRoom(`Room ${i}`, i);
    expect(s.listRooms().map((r) => r.id)).toEqual([
      "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11",
    ]);
  });

  it("lists bookings of a room in start order and numbers eleven bookings across two rooms in creation order", async () => {
    const s = await load();
    s.addRoom("A", 8);
    s.addRoom("B", 8);
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      const room = i % 2 === 0 ? "r1" : "r2";
      const h = String(8 + i).padStart(2, "0");
      const h2 = String(9 + i).padStart(2, "0");
      ids.push(s.addBooking(room, `t${i}`, `${D}${h}:00:00Z`, `${D}${h2}:00:00Z`, 1).id);
    }
    expect(ids).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b11"]);
    expect(s.listBookingsOfRoom("r1").map((b) => b.id)).toEqual(["b1", "b3", "b5", "b7", "b9", "b11"]);
    expect(s.listBookingsOfRoom("r2").map((b) => b.id)).toEqual(["b2", "b4", "b6", "b8", "b10"]);
  });

  it("orders bookings with the same start by numeric id, b2 before b10", async () => {
    const s = await load();
    for (let i = 1; i <= 10; i++) s.addRoom(`R${i}`, 1);
    s.addBooking("r1", "x", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    s.addBooking("r2", "x", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    for (let i = 3; i <= 9; i++) s.addBooking(`r${i}`, "x", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    s.removeBooking("b3");
    s.addBooking("r1", "y", `${D}10:00:00Z`, `${D}11:00:00Z`, 1);
    s.addBooking("r1", "z", `${D}10:00:00Z`, `${D}11:00:00Z`, 1);
    expect(s.listBookingsOfRoom("r1").map((b) => b.id)).toEqual(["b1", "b10", "b11"]);
    const t = await load();
    t.addRoom("A", 1);
    for (let i = 0; i < 10; i++) t.addBooking("r1", "q", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(t.listBookingsOfRoom("r1").map((b) => b.id)).toEqual([
      "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10",
    ]);
  });
});

describe("documented room and booking fields", () => {
  // @covers room-booking-api:INV-008
  it("carries exactly id, name and capacity on a room and exactly six fields on a booking", async () => {
    const s = await load();
    const room = s.addRoom("Aurora", 8);
    expect(Object.keys(room).sort()).toEqual(["capacity", "id", "name"]);
    expect(room).toEqual({ id: "r1", name: "Aurora", capacity: 8 });
    for (const r of s.listRooms()) expect(Object.keys(r).sort()).toEqual(["capacity", "id", "name"]);
    const b = s.addBooking("r1", "Standup", `${D}09:30Z`, `${D}10:00:00Z`, 3);
    const expected = {
      id: "b1", roomId: "r1", title: "Standup", start: `${D}09:30Z`, end: `${D}10:00:00Z`, attendees: 3,
    };
    expect(b).toEqual(expected);
    expect(Object.keys(b).sort()).toEqual(["attendees", "end", "id", "roomId", "start", "title"]);
    const listed = s.listBookingsOfRoom("r1");
    expect(listed).toEqual([expected]);
    expect(Object.keys(listed[0]).sort()).toEqual(["attendees", "end", "id", "roomId", "start", "title"]);
    expect(Object.keys(s.overlappingBookings("r1", ms("09:00:00"), ms("11:00:00"))[0]).sort()).toEqual([
      "attendees", "end", "id", "roomId", "start", "title",
    ]);
  });
});

describe("accepted time spellings", () => {
  it.each([
    ["2026-11-02T09:00Z", Date.UTC(2026, 10, 2, 9, 0, 0)],
    ["2026-11-02T09:00:00Z", Date.UTC(2026, 10, 2, 9, 0, 0)],
    ["2026-11-02T09:00:00.000Z", Date.UTC(2026, 10, 2, 9, 0, 0)],
  ])("parses %s to epoch milliseconds", async (text, value) => {
    const s = await load();
    expect(s.parseInstant(text)).toBe(value);
  });

  it.each([
    "2026-11-02T09:00:30Z",
    "2026-11-02T09:00:00.500Z",
    "2026-11-02T09:00:00+02:00",
    "2026-11-02T09:00+00:00",
    "2026-13-02T09:00Z",
    "2026-11-32T09:00Z",
    "2026-11-02T24:00Z",
    "2026-11-02T09:60Z",
    "2026-11-02",
    "tomorrow",
    "",
  ])("rejects %j as an instant", async (text) => {
    const s = await load();
    expect(s.parseInstant(text)).toBeUndefined();
  });
});
