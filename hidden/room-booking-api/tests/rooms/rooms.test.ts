import { describe, it, expect, vi } from "vitest";

type Rooms = typeof import("../../src/rooms/index.js");

// Room state is module-level; a fresh module graph per test gives each test an empty store.
async function load(): Promise<Rooms> {
  vi.resetModules();
  return await import("../../src/rooms/index.js");
}

const INVALID_ROOM = { status: 400, body: { error: "invalid_room" } };
const ROOM_NAME_TAKEN = { status: 409, body: { error: "room_name_taken" } };
const INVALID_QUERY = { status: 400, body: { error: "invalid_query" } };

const q = (s: string) => new URLSearchParams(s);

describe("createRoom", () => {
  // @covers room-booking-api:BEH-001
  it("creates the first Room with id r1, then r2, and GET lists them", async () => {
    const m = await load();
    expect(m.createRoom({ name: "Aurora", capacity: 8 })).toEqual({
      room: { id: "r1", name: "Aurora", capacity: 8 },
    });
    expect(m.createRoom({ name: "Birch", capacity: 4 })).toEqual({
      room: { id: "r2", name: "Birch", capacity: 4 },
    });
    expect(m.createRoom({ name: "Nook", capacity: 1 })).toEqual({
      room: { id: "r3", name: "Nook", capacity: 1 },
    });
    expect(m.listRooms(q(""))).toEqual({
      rooms: [
        { id: "r1", name: "Aurora", capacity: 8 },
        { id: "r2", name: "Birch", capacity: 4 },
        { id: "r3", name: "Nook", capacity: 1 },
      ],
    });
  });

  it("answers room_name_taken for a repeated body and keeps a single Room", async () => {
    const m = await load();
    m.createRoom({ name: "Aurora", capacity: 8 });
    expect(m.createRoom({ name: "Aurora", capacity: 8 })).toEqual(ROOM_NAME_TAKEN);
    expect(m.listRooms(q(""))).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 8 }] });
  });

  it("answers invalid_room for an absent capacity and leaves the Room list unchanged", async () => {
    const m = await load();
    m.createRoom({ name: "Birch", capacity: 4 });
    const before = JSON.stringify(m.listRooms(q("")));
    expect(m.createRoom({ name: "Aurora" })).toEqual(INVALID_ROOM);
    expect(JSON.stringify(m.listRooms(q("")))).toBe(before);
  });

  // @covers room-booking-api:BEH-002
  it.each([
    ["empty name", { name: "", capacity: 8 }],
    ["41-character name", { name: "A".repeat(41), capacity: 8 }],
    ["41 code points of emoji", { name: "😀".repeat(41), capacity: 8 }],
    ["capacity 0", { name: "Zero", capacity: 0 }],
    ["capacity 101", { name: "Wide", capacity: 101 }],
    ["negative capacity", { name: "Neg", capacity: -3 }],
    ["absent name", { capacity: 8 }],
    ["name not a string", { name: 7, capacity: 8 }],
    ["null name", { name: null, capacity: 8 }],
    ["null capacity", { name: "Nul", capacity: null }],
    ["boolean capacity", { name: "Bool", capacity: true }],
  ])("rejects %s with invalid_room and stores no Room", async (_label, body) => {
    const m = await load();
    expect(m.createRoom(body)).toEqual(INVALID_ROOM);
    expect(m.listRooms(q(""))).toEqual({ rooms: [] });
  });

  it.each([
    ["an array", []],
    ["a string", "Aurora"],
    ["a number", 8],
    ["null", null],
    ["a boolean", true],
  ])("rejects a valid JSON body that is %s with invalid_room", async (_label, body) => {
    const m = await load();
    expect(m.createRoom(body)).toEqual(INVALID_ROOM);
    expect(m.listRooms(q(""))).toEqual({ rooms: [] });
  });

  it("accepts the boundary names and capacities", async () => {
    const m = await load();
    const forty = "A".repeat(40);
    expect(m.createRoom({ name: forty, capacity: 1 })).toEqual({
      room: { id: "r1", name: forty, capacity: 1 },
    });
    expect(m.createRoom({ name: "Hall", capacity: 100 })).toEqual({
      room: { id: "r2", name: "Hall", capacity: 100 },
    });
    const emoji = "😀".repeat(40);
    expect(m.createRoom({ name: emoji, capacity: 2 })).toEqual({
      room: { id: "r3", name: emoji, capacity: 2 },
    });
    expect(m.listRooms(q("")).hasOwnProperty("rooms")).toBe(true);
    expect((m.listRooms(q("")) as { rooms: unknown[] }).rooms).toHaveLength(3);
  });

  // @covers room-booking-api:BEH-003
  it("rejects a case-insensitive repeat of a Room name with room_name_taken", async () => {
    const m = await load();
    m.createRoom({ name: "Aurora", capacity: 8 });
    expect(m.createRoom({ name: "Aurora", capacity: 4 })).toEqual(ROOM_NAME_TAKEN);
    expect(m.createRoom({ name: "aurora", capacity: 4 })).toEqual(ROOM_NAME_TAKEN);
    expect(m.createRoom({ name: "AURORA", capacity: 4 })).toEqual(ROOM_NAME_TAKEN);
    expect(m.listRooms(q(""))).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 8 }] });
    expect(m.createRoom({ name: "Aurora 2", capacity: 4 })).toEqual({
      room: { id: "r2", name: "Aurora 2", capacity: 4 },
    });
    expect((m.listRooms(q("")) as { rooms: unknown[] }).rooms).toHaveLength(2);
  });

  it("lets a name rejected with invalid_room be used later and decides invalid_room first", async () => {
    const m = await load();
    expect(m.createRoom({ name: "Aurora 3", capacity: 0 })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ name: "Aurora 3", capacity: 4 })).toEqual({
      room: { id: "r1", name: "Aurora 3", capacity: 4 },
    });
    m.createRoom({ name: "Aurora", capacity: 8 });
    expect(m.createRoom({ name: "", capacity: 4 })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ name: "aurora", capacity: 0 })).toEqual(INVALID_ROOM);
  });

  // @covers room-booking-api:BEH-024
  it("drops an unknown field and never lets it rescue an invalid body", async () => {
    const m = await load();
    expect(m.createRoom({ name: "Aurora", capacity: 0, colour: "blue" })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ capacity: 8, colour: "blue" })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ colour: "blue" })).toEqual(INVALID_ROOM);
    expect(m.listRooms(q(""))).toEqual({ rooms: [] });
    const created = m.createRoom({ name: "Aurora", capacity: 8, colour: "blue" });
    expect(created).toEqual({ room: { id: "r1", name: "Aurora", capacity: 8 } });
    expect(Object.keys((created as { room: object }).room).sort()).toEqual(["capacity", "id", "name"]);
    expect(m.listRooms(q(""))).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 8 }] });
  });

  // @covers room-booking-api:BEH-027
  it("accepts capacity 8.0 as the integer 8 and rejects 8.5 and the string 8", async () => {
    const m = await load();
    const parsed: unknown = JSON.parse('{"name":"Aurora","capacity":8.0}');
    expect(m.createRoom(parsed)).toEqual({ room: { id: "r1", name: "Aurora", capacity: 8 } });
    expect(m.createRoom({ name: "Half", capacity: 8.5 })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ name: "Text", capacity: "8" })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ name: "Absent" })).toEqual(INVALID_ROOM);
    expect((m.listRooms(q("")) as { rooms: unknown[] }).rooms).toHaveLength(1);
  });

  // @covers room-booking-api:CTR-001
  it("answers exactly the documented outcomes of the create-room endpoint", async () => {
    const m = await load();
    expect(m.createRoom({ name: "Aurora", capacity: 8 })).toEqual({
      room: { id: "r1", name: "Aurora", capacity: 8 },
    });
    expect(m.createRoom({ name: "A".repeat(41), capacity: 8 })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ name: "Zero", capacity: 0 })).toEqual(INVALID_ROOM);
    expect(m.createRoom({ name: "Wide", capacity: 101 })).toEqual(INVALID_ROOM);
    expect(m.createRoom([])).toEqual(INVALID_ROOM);
    expect(m.createRoom({ name: "aurora", capacity: 4 })).toEqual(ROOM_NAME_TAKEN);
    expect(m.createRoom({ name: "Hall", capacity: 100 })).toEqual({
      room: { id: "r2", name: "Hall", capacity: 100 },
    });
    expect(m.createRoom({ name: "Nook", capacity: 1 })).toEqual({
      room: { id: "r3", name: "Nook", capacity: 1 },
    });
  });
});

describe("listRooms", () => {
  async function seed(m: Rooms, capacities: number[]) {
    capacities.forEach((c, i) => m.createRoom({ name: `Room ${i + 1}`, capacity: c }));
  }

  // @covers room-booking-api:BEH-004
  it("returns an empty rooms array for an empty store and rooms in numeric id order", async () => {
    const m = await load();
    expect(m.listRooms(q(""))).toEqual({ rooms: [] });
    await seed(m, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const result = m.listRooms(q("")) as { rooms: Array<{ id: string }> };
    expect(result.rooms.map((r) => r.id)).toEqual([
      "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10",
    ]);
    for (const r of result.rooms) {
      expect(Object.keys(r).sort()).toEqual(["capacity", "id", "name"]);
    }
  });

  it("returns one Room with exactly id, name and capacity", async () => {
    const m = await load();
    m.createRoom({ name: "Aurora", capacity: 3 });
    expect(m.listRooms(q(""))).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 3 }] });
  });

  // @covers room-booking-api:BEH-005
  it("filters by minCapacity at the exact bound, above all and at the smallest capacity", async () => {
    const m = await load();
    await seed(m, [3, 8, 8]);
    const ids = (s: string) =>
      (m.listRooms(q(s)) as { rooms: Array<{ id: string }> }).rooms.map((r) => r.id);
    expect(ids("minCapacity=8")).toEqual(["r2", "r3"]);
    expect(m.listRooms(q("minCapacity=9"))).toEqual({ rooms: [] });
    expect(ids("minCapacity=3")).toEqual(["r1", "r2", "r3"]);
    expect(ids("")).toEqual(["r1", "r2", "r3"]);
    expect(m.listRooms(q("minCapacity=8"))).toEqual({
      rooms: [
        { id: "r2", name: "Room 2", capacity: 8 },
        { id: "r3", name: "Room 3", capacity: 8 },
      ],
    });
  });

  // @covers room-booking-api:BEH-006
  it.each([
    ["zero", "minCapacity=0"],
    ["negative", "minCapacity=-1"],
    ["decimal", "minCapacity=4.5"],
    ["non-numeric text", "minCapacity=abc"],
    ["empty value", "minCapacity="],
  ])("rejects a %s minCapacity with invalid_query", async (_label, query) => {
    const m = await load();
    await seed(m, [3, 8]);
    expect(m.listRooms(q(query))).toEqual(INVALID_QUERY);
    expect(m.listRooms(q(""))).toEqual({
      rooms: [
        { id: "r1", name: "Room 1", capacity: 3 },
        { id: "r2", name: "Room 2", capacity: 8 },
      ],
    });
  });

  it("accepts minCapacity 1 and 100 as positive integers", async () => {
    const m = await load();
    await seed(m, [1, 100]);
    expect(m.listRooms(q("minCapacity=1"))).toEqual({
      rooms: [
        { id: "r1", name: "Room 1", capacity: 1 },
        { id: "r2", name: "Room 2", capacity: 100 },
      ],
    });
    expect(m.listRooms(q("minCapacity=100"))).toEqual({
      rooms: [{ id: "r2", name: "Room 2", capacity: 100 }],
    });
  });

  // @covers room-booking-api:CTR-002
  it("answers exactly the documented outcomes of the list-rooms endpoint", async () => {
    const m = await load();
    expect(m.listRooms(q(""))).toEqual({ rooms: [] });
    await seed(m, [3, 8]);
    expect(m.listRooms(q(""))).toEqual({
      rooms: [
        { id: "r1", name: "Room 1", capacity: 3 },
        { id: "r2", name: "Room 2", capacity: 8 },
      ],
    });
    expect(m.listRooms(q("minCapacity=8"))).toEqual({
      rooms: [{ id: "r2", name: "Room 2", capacity: 8 }],
    });
    expect(m.listRooms(q("minCapacity=0"))).toEqual(INVALID_QUERY);
    expect(Object.keys(m.listRooms(q("")))).toEqual(["rooms"]);
  });
});
