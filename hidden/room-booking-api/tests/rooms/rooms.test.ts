import { describe, expect, it } from "vitest";
import { createRoom, listRooms } from "../../src/rooms/index.js";
import { createStore } from "../../src/store/index.js";

const NAME_40 = "0123456789012345678901234567890123456789";
const NAME_41 = "01234567890123456789012345678901234567890";

const query = (qs = "") => new URLSearchParams(qs);

const seedThree = () => {
  const store = createStore();
  store.rooms.create("Aurora", 4);
  store.rooms.create("Borealis", 12);
  store.rooms.create("Cirrus", 8);
  return store;
};

const R1 = { id: "r1", name: "Aurora", capacity: 4 };
const R2 = { id: "r2", name: "Borealis", capacity: 12 };
const R3 = { id: "r3", name: "Cirrus", capacity: 8 };

describe("room creation", () => {
  // @covers room-booking-api:BEH-001
  it("a valid room body is accepted with id r1 and the next accepted room receives r2", () => {
    const store = createStore();
    expect(createRoom(store.rooms, { name: "Aurora", capacity: 6 })).toEqual({
      ok: true,
      status: 201,
      body: { id: "r1", name: "Aurora", capacity: 6 },
    });
    expect(createRoom(store.rooms, { name: "Borealis", capacity: 2 })).toEqual({
      ok: true,
      status: 201,
      body: { id: "r2", name: "Borealis", capacity: 2 },
    });
    expect(store.rooms.list().map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("a room with capacity 0 is rejected with invalid_room and no room named Aurora exists", () => {
    const store = createStore();
    expect(createRoom(store.rooms, { name: "Aurora", capacity: 0 })).toMatchObject({ ok: false, code: "invalid_room" });
    expect(store.rooms.list()).toHaveLength(0);
  });

  it("a room body without capacity is rejected with invalid_room", () => {
    const store = createStore();
    expect(createRoom(store.rooms, { name: "Cirrus" })).toMatchObject({ ok: false, code: "invalid_room" });
    expect(store.rooms.list()).toHaveLength(0);
  });

  it.each([null, [], "Aurora", 5, { capacity: 3 }, { name: 7, capacity: 3 }, { name: "Aurora", capacity: "3" }])(
    "a malformed room body %j is rejected with invalid_room",
    (body) => {
      const store = createStore();
      expect(createRoom(store.rooms, body)).toMatchObject({ ok: false, code: "invalid_room" });
      expect(store.rooms.list()).toHaveLength(0);
    },
  );

  // @covers room-booking-api:BEH-002
  it("each of empty name, 41-character name, capacity 0, capacity 101 and capacity 1.5 is rejected with invalid_room and leaves the room count unchanged", () => {
    const bodies = [
      { name: "", capacity: 2 },
      { name: NAME_41, capacity: 1 },
      { name: "Dorado", capacity: 0 },
      { name: "Dorado", capacity: 101 },
      { name: "Dorado", capacity: 1.5 },
    ];
    for (const body of bodies) {
      const store = createStore();
      store.rooms.create("Existing", 5);
      expect(createRoom(store.rooms, body)).toMatchObject({ ok: false, code: "invalid_room" });
      expect(store.rooms.list()).toHaveLength(1);
    }
  });

  it("a whitespace-only name is rejected with invalid_room", () => {
    const store = createStore();
    expect(createRoom(store.rooms, { name: "   ", capacity: 2 })).toMatchObject({ ok: false, code: "invalid_room" });
    expect(store.rooms.list()).toHaveLength(0);
  });

  it.each([
    [NAME_40, 1],
    ["Borealis", 1],
    ["Cirrus", 100],
  ])("the boundary room %s with capacity %i is accepted with 201", (name, capacity) => {
    const store = createStore();
    expect(createRoom(store.rooms, { name, capacity })).toEqual({
      ok: true,
      status: 201,
      body: { id: "r1", name, capacity },
    });
  });

  it("a name counts code points, so 40 emoji are accepted and 41 emoji are rejected with invalid_room", () => {
    const store = createStore();
    expect(createRoom(store.rooms, { name: "😀".repeat(40), capacity: 1 })).toMatchObject({ ok: true, status: 201 });
    expect(createRoom(store.rooms, { name: "😀".repeat(41), capacity: 1 })).toMatchObject({
      ok: false,
      code: "invalid_room",
    });
    expect(store.rooms.list()).toHaveLength(1);
  });

  it("a client-supplied id is ignored and the server assigns r2", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    expect(createRoom(store.rooms, { id: "r99", name: "Eurus", capacity: 4 })).toEqual({
      ok: true,
      status: 201,
      body: { id: "r2", name: "Eurus", capacity: 4 },
    });
  });

  // @covers room-booking-api:BEH-003
  it("a room name differing only in case is rejected with room_name_taken and the room count stays unchanged", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    expect(createRoom(store.rooms, { name: "AURORA", capacity: 3 })).toMatchObject({
      ok: false,
      code: "room_name_taken",
    });
    expect(store.rooms.list()).toHaveLength(1);
  });

  it("an identical room name is rejected with room_name_taken, not invalid_room", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    expect(createRoom(store.rooms, { name: "Aurora", capacity: 3 })).toMatchObject({
      ok: false,
      code: "room_name_taken",
    });
    expect(store.rooms.list()).toHaveLength(1);
  });

  it("a distinct room name is accepted with id r2 while Aurora exists", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    expect(createRoom(store.rooms, { name: "Borealis", capacity: 3 })).toEqual({
      ok: true,
      status: 201,
      body: { id: "r2", name: "Borealis", capacity: 3 },
    });
    expect(store.rooms.list()).toHaveLength(2);
  });

  it("an empty name while Aurora exists is rejected with invalid_room", () => {
    const store = createStore();
    store.rooms.create("Aurora", 6);
    expect(createRoom(store.rooms, { name: "", capacity: 3 })).toMatchObject({ ok: false, code: "invalid_room" });
  });

  // @covers room-booking-api:CTR-001
  it("create room contract: a valid body responds 201 with an r-prefixed id and invalid bodies respond with the documented code", () => {
    const store = createStore();
    const created = createRoom(store.rooms, { name: "Aurora", capacity: 6 });
    expect(created).toEqual({ ok: true, status: 201, body: { id: "r1", name: "Aurora", capacity: 6 } });
    expect(createRoom(store.rooms, { name: NAME_41, capacity: 2 })).toMatchObject({ ok: false, code: "invalid_room" });
    expect(createRoom(store.rooms, { name: "Dorado", capacity: 101 })).toMatchObject({
      ok: false,
      code: "invalid_room",
    });
    expect(createRoom(store.rooms, { name: "aurora", capacity: 2 })).toMatchObject({
      ok: false,
      code: "room_name_taken",
    });
    expect(store.rooms.list()).toHaveLength(1);
  });
});

describe("room listing", () => {
  // @covers room-booking-api:BEH-004
  it("an empty store lists an empty rooms array, three rooms come back in ascending id order and minCapacity=8 keeps r2 and r3", () => {
    expect(listRooms(createStore().rooms, query())).toEqual({ ok: true, status: 200, body: { rooms: [] } });
    const store = seedThree();
    expect(listRooms(store.rooms, query())).toEqual({ ok: true, status: 200, body: { rooms: [R1, R2, R3] } });
    expect(listRooms(store.rooms, query("minCapacity=8"))).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [R2, R3] },
    });
  });

  it("a single room r1 is listed alone", () => {
    const store = createStore();
    store.rooms.create("Aurora", 4);
    expect(listRooms(store.rooms, query())).toEqual({ ok: true, status: 200, body: { rooms: [R1] } });
  });

  it("minCapacity above all capacities lists an empty rooms array", () => {
    expect(listRooms(seedThree().rooms, query("minCapacity=13"))).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [] },
    });
  });

  // @covers room-booking-api:BEH-005
  it("minCapacity values 0, -1, 1.5 and abc each respond invalid_query while 1 and an absent value respond 200", () => {
    const store = seedThree();
    for (const value of ["0", "-1", "1.5", "abc"]) {
      expect(listRooms(store.rooms, query(`minCapacity=${value}`))).toMatchObject({
        ok: false,
        code: "invalid_query",
      });
    }
    expect(listRooms(store.rooms, query("minCapacity=1"))).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [R1, R2, R3] },
    });
    expect(listRooms(store.rooms, query())).toMatchObject({ ok: true, status: 200 });
  });

  // @covers room-booking-api:CTR-002
  it("list rooms contract: rooms are ordered by id and minCapacity keeps capacity at least the value, including equality", () => {
    const store = seedThree();
    expect(listRooms(store.rooms, query())).toEqual({ ok: true, status: 200, body: { rooms: [R1, R2, R3] } });
    expect(listRooms(store.rooms, query("minCapacity=1"))).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [R1, R2, R3] },
    });
    expect(listRooms(store.rooms, query("minCapacity=12"))).toEqual({
      ok: true,
      status: 200,
      body: { rooms: [R2] },
    });
    expect(listRooms(store.rooms, query("minCapacity=0"))).toMatchObject({ ok: false, code: "invalid_query" });
    expect(listRooms(store.rooms, query("minCapacity=abc"))).toMatchObject({ ok: false, code: "invalid_query" });
  });
});
