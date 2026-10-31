import { describe, expect, it } from "vitest";
import { createStore } from "../../src/domain/index.js";
import type { Store } from "../../src/domain/index.js";
import { createRoom, listRooms } from "../../src/rooms/index.js";
import { errorBody, statusFor } from "../../src/errors/index.js";

const q = (s = "") => new URLSearchParams(s);
const names = ["Aurora", "Borealis", "Cirrus", "Delta", "Echo", "Fjord", "Gale", "Haze", "Iris", "Jade", "Kilo", "Lumen"];

function seed(store: Store, count: number): void {
  for (let i = 0; i < count; i++) createRoom(store, { name: names[i], capacity: 4 });
}

describe("POST /rooms createRoom", () => {
  // @covers room-booking-api:BEH-001
  it("a valid room body on an empty server creates r1 and lists exactly that room", () => {
    const store = createStore();
    const res = createRoom(store, { name: "Aurora", capacity: 4 });
    expect(res).toEqual({ ok: true, value: { id: "r1", name: "Aurora", capacity: 4 } });
    expect(listRooms(store, q())).toEqual({ ok: true, value: { rooms: [{ id: "r1", name: "Aurora", capacity: 4 }] } });
  });

  it("a second room with a different name gets r2", () => {
    const store = createStore();
    createRoom(store, { name: "Aurora", capacity: 4 });
    expect(createRoom(store, { name: "Borealis", capacity: 4 })).toEqual({
      ok: true,
      value: { id: "r2", name: "Borealis", capacity: 4 },
    });
  });

  it.each([
    ["A", 4],
    ["x".repeat(40), 4],
    ["Aurora", 1],
    ["Aurora", 100],
  ])("boundary room name %j capacity %i is accepted", (name, capacity) => {
    const store = createStore();
    expect(createRoom(store, { name, capacity })).toEqual({ ok: true, value: { id: "r1", name, capacity } });
  });

  // @covers room-booking-api:BEH-002
  it.each<[string, Record<string, unknown>]>([
    ["empty name", { name: "", capacity: 1 }],
    ["whitespace name", { name: "   ", capacity: 1 }],
    ["41-character name", { name: "x".repeat(41), capacity: 1 }],
    ["capacity 0", { name: "Aurora", capacity: 0 }],
    ["capacity 101", { name: "Aurora", capacity: 101 }],
    ["fractional capacity", { name: "Aurora", capacity: 2.5 }],
    ["non-string name", { name: 7, capacity: 4 }],
    ["missing capacity", { name: "Aurora" }],
  ])("invalid %s answers invalid_room and leaves the room count unchanged", (_label, body) => {
    const store = createStore();
    seed(store, 2);
    const res = createRoom(store, body);
    expect(res).toEqual({ ok: false, error: { code: "invalid_room" } });
    const list = listRooms(store, q());
    expect(list.ok && list.value.rooms.length).toBe(2);
  });

  // @covers room-booking-api:BEH-003
  it.each(["Aurora", "aurora", "AURORA"])("name %s after Aurora answers room_name_taken and creates no room", (name) => {
    const store = createStore();
    createRoom(store, { name: "Aurora", capacity: 4 });
    expect(createRoom(store, { name, capacity: 9 })).toEqual({ ok: false, error: { code: "room_name_taken" } });
    expect(listRooms(store, q())).toEqual({ ok: true, value: { rooms: [{ id: "r1", name: "Aurora", capacity: 4 }] } });
  });

  it("name Borealis after Aurora is accepted as r2", () => {
    const store = createStore();
    createRoom(store, { name: "Aurora", capacity: 4 });
    expect(createRoom(store, { name: "Borealis", capacity: 4 })).toMatchObject({ ok: true, value: { id: "r2" } });
  });

  // @covers room-booking-api:CTR-002
  it("created room body has exactly id, name and capacity and each error maps to its documented status and body", () => {
    const store = createStore();
    const res = createRoom(store, { name: "Aurora", capacity: 4 });
    expect(res.ok && Object.keys(res.value).sort()).toEqual(["capacity", "id", "name"]);
    const invalid = createRoom(store, { name: "Aurora2", capacity: 0 });
    expect(invalid).toEqual({ ok: false, error: { code: "invalid_room" } });
    const taken = createRoom(store, { name: "aurora", capacity: 4 });
    expect(taken).toEqual({ ok: false, error: { code: "room_name_taken" } });
    expect(statusFor("invalid_room")).toBe(400);
    expect(statusFor("room_name_taken")).toBe(409);
    expect(errorBody({ code: "invalid_room" })).toEqual({ error: "invalid_room" });
    expect(errorBody({ code: "room_name_taken" })).toEqual({ error: "room_name_taken" });
  });
});

describe("GET /rooms listRooms", () => {
  // @covers room-booking-api:BEH-004
  it("lists all 12 rooms ordered r1 to r12 so r10 follows r9", () => {
    const store = createStore();
    seed(store, 12);
    const res = listRooms(store, q());
    expect(res.ok && res.value.rooms.map((r) => r.id)).toEqual([
      "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12",
    ]);
  });

  it("an empty server lists no rooms", () => {
    expect(listRooms(createStore(), q())).toEqual({ ok: true, value: { rooms: [] } });
  });

  it("minCapacity=abc answers invalid_query instead of a room list", () => {
    const store = createStore();
    seed(store, 1);
    expect(listRooms(store, q("minCapacity=abc"))).toEqual({ ok: false, error: { code: "invalid_query" } });
  });

  // @covers room-booking-api:BEH-005
  it("minCapacity keeps rooms with capacity at least the value, ordered by id", () => {
    const store = createStore();
    createRoom(store, { name: "Aurora", capacity: 4 });
    createRoom(store, { name: "Borealis", capacity: 10 });
    createRoom(store, { name: "Cirrus", capacity: 40 });
    const ids = (s: string) => {
      const r = listRooms(store, q(s));
      return r.ok ? r.value.rooms.map((x) => x.id) : r.error.code;
    };
    expect(ids("minCapacity=5")).toEqual(["r2", "r3"]);
    expect(ids("minCapacity=10")).toEqual(["r2", "r3"]);
    expect(ids("")).toEqual(["r1", "r2", "r3"]);
    expect(listRooms(store, q("minCapacity=41"))).toEqual({ ok: true, value: { rooms: [] } });
  });

  it.each(["0", "-1", "2.5", "ten"])("minCapacity=%s answers invalid_query", (value) => {
    const store = createStore();
    seed(store, 3);
    expect(listRooms(store, q(`minCapacity=${value}`))).toEqual({ ok: false, error: { code: "invalid_query" } });
  });

  // @covers room-booking-api:CTR-003
  it("list envelope holds ordered rooms, filters by minCapacity and maps invalid_query to 400", () => {
    const store = createStore();
    createRoom(store, { name: "Aurora", capacity: 4 });
    createRoom(store, { name: "Borealis", capacity: 10 });
    expect(listRooms(store, q())).toEqual({
      ok: true,
      value: { rooms: [{ id: "r1", name: "Aurora", capacity: 4 }, { id: "r2", name: "Borealis", capacity: 10 }] },
    });
    expect(listRooms(store, q("minCapacity=10"))).toEqual({
      ok: true,
      value: { rooms: [{ id: "r2", name: "Borealis", capacity: 10 }] },
    });
    expect(listRooms(store, q("minCapacity=0"))).toEqual({ ok: false, error: { code: "invalid_query" } });
    expect(statusFor("invalid_query")).toBe(400);
    expect(errorBody({ code: "invalid_query" })).toEqual({ error: "invalid_query" });
  });
});
