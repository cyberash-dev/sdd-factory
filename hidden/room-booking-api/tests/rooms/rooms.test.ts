import { describe, it, expect } from "vitest";
import { URLSearchParams } from "node:url";
import { createRoomStore, createRoom, listRooms } from "../../src/rooms/index.js";

const q = (s: string) => new URLSearchParams(s);
const snapshot = (store: ReturnType<typeof createRoomStore>) => JSON.stringify(listRooms(store, q("")));

describe("room creation (POST /rooms)", () => {
  // @covers room-booking-api:BEH-001
  it("creates a room with a server-assigned id and lists it", () => {
    const store = createRoomStore();
    expect(listRooms(store, q(""))).toEqual([]);
    expect(createRoom(store, { name: "Focus", capacity: 6 })).toEqual({ id: "r1", name: "Focus", capacity: 6 });
    expect(listRooms(store, q(""))).toEqual([{ id: "r1", name: "Focus", capacity: 6 }]);
  });

  it.each([
    ["A", 1],
    ["x".repeat(40), 100],
  ])("accepts boundary name %j with capacity %i", (name, capacity) => {
    const store = createRoomStore();
    expect(createRoom(store, { name, capacity })).toEqual({ id: "r1", name, capacity });
    expect(listRooms(store, q(""))).toHaveLength(1);
  });

  // @covers room-booking-api:BEH-002
  it("rejects an empty name with invalid_room and leaves the state unchanged", () => {
    const store = createRoomStore();
    const before = snapshot(store);
    expect(createRoom(store, { name: "", capacity: 6 })).toEqual({ error: "invalid_room" });
    expect(snapshot(store)).toBe(before);
  });

  it.each([
    ["whitespace only", { name: "   ", capacity: 6 }],
    ["missing", { capacity: 6 }],
    ["not a string", { name: 42, capacity: 6 }],
    ["41 characters", { name: "x".repeat(41), capacity: 6 }],
  ])("rejects a name that is %s with invalid_room", (_label, body) => {
    const store = createRoomStore();
    const before = snapshot(store);
    expect(createRoom(store, body)).toEqual({ error: "invalid_room" });
    expect(snapshot(store)).toBe(before);
  });

  it("accepts a 40-character name", () => {
    const store = createRoomStore();
    const name = "y".repeat(40);
    expect(createRoom(store, { name, capacity: 6 })).toEqual({ id: "r1", name, capacity: 6 });
  });

  // @covers room-booking-api:BEH-003
  it("rejects capacity 0 with invalid_room and leaves the state unchanged", () => {
    const store = createRoomStore();
    const before = snapshot(store);
    expect(createRoom(store, { name: "Lab", capacity: 0 })).toEqual({ error: "invalid_room" });
    expect(snapshot(store)).toBe(before);
  });

  it.each([
    ["101", { name: "Lab", capacity: 101 }],
    ["missing", { name: "Lab" }],
    ["1.5", { name: "Lab", capacity: 1.5 }],
    ['the string "6"', { name: "Lab", capacity: "6" }],
  ])("rejects capacity %s with invalid_room", (_label, body) => {
    const store = createRoomStore();
    const before = snapshot(store);
    expect(createRoom(store, body)).toEqual({ error: "invalid_room" });
    expect(snapshot(store)).toBe(before);
  });

  it.each([
    ["Nook", 1],
    ["Hall", 100],
  ])("accepts boundary capacity of room %s", (name, capacity) => {
    const store = createRoomStore();
    expect(createRoom(store, { name, capacity })).toEqual({ id: "r1", name, capacity });
  });

  // @covers room-booking-api:BEH-004
  it.each(["focus", "FOCUS", "Focus"])("rejects name %s while Focus exists with room_name_taken", (name) => {
    const store = createRoomStore();
    createRoom(store, { name: "Focus", capacity: 6 });
    const before = snapshot(store);
    expect(createRoom(store, { name, capacity: 6 })).toEqual({ error: "room_name_taken" });
    expect(snapshot(store)).toBe(before);
    expect(listRooms(store, q(""))).toEqual([{ id: "r1", name: "Focus", capacity: 6 }]);
  });

  it("accepts names that differ by one character", () => {
    const store = createRoomStore();
    createRoom(store, { name: "Focus", capacity: 6 });
    expect(createRoom(store, { name: "Field", capacity: 6 })).toEqual({ id: "r2", name: "Field", capacity: 6 });
    expect(createRoom(store, { name: "Focuz", capacity: 6 })).toEqual({ id: "r3", name: "Focuz", capacity: 6 });
  });

  // @covers room-booking-api:INV-005
  it("keeps room names unique case-insensitively and stores the sent spelling", () => {
    const store = createRoomStore();
    createRoom(store, { name: "Focus", capacity: 6 });
    expect(createRoom(store, { name: "focus", capacity: 6 })).toEqual({ error: "room_name_taken" });
    expect(createRoom(store, { name: "Field", capacity: 6 })).toEqual({ id: "r2", name: "Field", capacity: 6 });
    const names = (listRooms(store, q("")) as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(["Focus", "Field"]);
  });

  // @covers room-booking-api:CTR-001
  it("answers every POST /rooms body with a room or one of invalid_room and room_name_taken", () => {
    const store = createRoomStore();
    expect(createRoom(store, { name: "Focus", capacity: 6 })).toEqual({ id: "r1", name: "Focus", capacity: 6 });
    expect(createRoom(store, { name: "", capacity: 6 })).toEqual({ error: "invalid_room" });
    expect(createRoom(store, { name: "focus", capacity: 6 })).toEqual({ error: "room_name_taken" });
    expect(createRoom(store, null)).toEqual({ error: "invalid_room" });
    expect(createRoom(store, "x")).toEqual({ error: "invalid_room" });
    expect(listRooms(store, q(""))).toHaveLength(1);
  });

  it("ignores unknown body properties", () => {
    const store = createRoomStore();
    expect(createRoom(store, { name: "Focus", capacity: 6, floor: 3 })).toEqual({ id: "r1", name: "Focus", capacity: 6 });
  });
});

describe("room listing (GET /rooms)", () => {
  // @covers room-booking-api:BEH-005
  it("lists ten rooms in ascending id order past the ninth room", () => {
    const store = createRoomStore();
    for (let i = 1; i <= 10; i++) createRoom(store, { name: `Room ${i}`, capacity: 5 });
    const ids = (listRooms(store, q("")) as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"]);
  });

  it("lists an empty state as an empty array", () => {
    expect(listRooms(createRoomStore(), q(""))).toEqual([]);
  });

  it("rejects minCapacity=abc with invalid_query", () => {
    expect(listRooms(createRoomStore(), q("minCapacity=abc"))).toEqual({ error: "invalid_query" });
  });

  it("ignores unknown query parameters", () => {
    const store = createRoomStore();
    createRoom(store, { name: "Focus", capacity: 6 });
    expect(listRooms(store, q("foo=bar"))).toEqual([{ id: "r1", name: "Focus", capacity: 6 }]);
  });

  // @covers room-booking-api:BEH-006
  it("keeps rooms whose capacity is at least minCapacity in id order", () => {
    const store = createRoomStore();
    createRoom(store, { name: "A", capacity: 4 });
    createRoom(store, { name: "B", capacity: 8 });
    createRoom(store, { name: "C", capacity: 12 });
    const ids = (s: string) => (listRooms(store, q(s)) as { id: string }[]).map((r) => r.id);
    expect(ids("minCapacity=8")).toEqual(["r2", "r3"]);
    expect(ids("minCapacity=4")).toEqual(["r1", "r2", "r3"]);
    expect(ids("minCapacity=1")).toEqual(["r1", "r2", "r3"]);
    expect(ids("minCapacity=20")).toEqual([]);
    expect(ids("")).toEqual(["r1", "r2", "r3"]);
  });

  // @covers room-booking-api:BEH-007
  it.each(["0", "-1", "abc", "1.5"])("rejects minCapacity=%s with invalid_query", (value) => {
    const store = createRoomStore();
    createRoom(store, { name: "Focus", capacity: 6 });
    expect(listRooms(store, q(`minCapacity=${value}`))).toEqual({ error: "invalid_query" });
    expect(listRooms(store, q(""))).toEqual([{ id: "r1", name: "Focus", capacity: 6 }]);
  });

  it("accepts minCapacity=1", () => {
    const store = createRoomStore();
    createRoom(store, { name: "Focus", capacity: 6 });
    expect(listRooms(store, q("minCapacity=1"))).toEqual([{ id: "r1", name: "Focus", capacity: 6 }]);
  });

  // @covers room-booking-api:CTR-002
  it("answers GET /rooms with every room in ascending id order or invalid_query", () => {
    const store = createRoomStore();
    expect(listRooms(store, q(""))).toEqual([]);
    createRoom(store, { name: "A", capacity: 2 });
    createRoom(store, { name: "B", capacity: 3 });
    createRoom(store, { name: "C", capacity: 4 });
    expect(listRooms(store, q(""))).toEqual([
      { id: "r1", name: "A", capacity: 2 },
      { id: "r2", name: "B", capacity: 3 },
      { id: "r3", name: "C", capacity: 4 },
    ]);
    expect(listRooms(store, q("minCapacity=0"))).toEqual({ error: "invalid_query" });
  });
});
