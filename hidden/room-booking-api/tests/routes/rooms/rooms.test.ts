import { describe, expect, it } from "vitest";
import { createStore, parseJsonBody } from "../../../src/core/index.js";
import type { ParsedBody, Store } from "../../../src/core/index.js";
import { handleCreateRoom, handleListRooms } from "../../../src/routes/rooms/index.js";

const val = (value: unknown): ParsedBody => ({ kind: "value", value });
const NAME_40 = "0123456789012345678901234567890123456789";
const NAME_41 = "01234567890123456789012345678901234567890";

function seed(store: Store, specs: Array<[string, number]>): void {
  for (const [name, capacity] of specs) store.addRoom(name, capacity);
}
const list = (store: Store, qs = "", body: ParsedBody = { kind: "empty" }) =>
  handleListRooms(store, new URLSearchParams(qs), body);
const ids = (res: { body?: unknown }): unknown =>
  (res.body as { rooms: Array<{ id: string }> }).rooms.map((r) => r.id);

describe("room creation (BEH-001)", () => {
  // @covers room-booking-api:BEH-001
  it("answers 201 with room r1 and lists the created room", () => {
    const store = createStore();
    const res = handleCreateRoom(store, val({ name: "Lab", capacity: 10 }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", name: "Lab", capacity: 10 });
    expect(list(store).body).toEqual({ rooms: [{ id: "r1", name: "Lab", capacity: 10 }] });
  });

  it("assigns id r(N+1) after existing rooms", () => {
    const store = createStore();
    seed(store, [["A", 1], ["B", 2], ["C", 3]]);
    const res = handleCreateRoom(store, val({ name: "Lab", capacity: 10 }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r4", name: "Lab", capacity: 10 });
    expect(ids(list(store))).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it.each([
    ["capacity 1", { name: "A", capacity: 1 }],
    ["capacity 100", { name: "B", capacity: 100 }],
    ["name of 1 character", { name: "x", capacity: 10 }],
    ["name of 40 characters", { name: NAME_40, capacity: 10 }],
  ])("accepts the boundary %s", (_label, body) => {
    const res = handleCreateRoom(createStore(), val(body));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", ...body });
  });

  it.each([[0], [101]])("rejects capacity %s and keeps the store unchanged", (capacity) => {
    const store = createStore();
    const res = handleCreateRoom(store, val({ name: "C", capacity }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_room" });
    expect(list(store).body).toEqual({ rooms: [] });
  });
});

describe("room creation validation (BEH-002)", () => {
  it("accepts the valid typical body", () => {
    const res = handleCreateRoom(createStore(), val({ name: "Lab", capacity: 10 }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", name: "Lab", capacity: 10 });
  });

  // @covers room-booking-api:BEH-002
  it.each([
    ["name of 41 characters", { name: NAME_41, capacity: 10 }],
    ["empty name", { name: "", capacity: 10 }],
    ["capacity 0", { name: "Lab", capacity: 0 }],
    ["capacity 101", { name: "Lab", capacity: 101 }],
    ["capacity 1.5", { name: "Lab", capacity: 1.5 }],
    ["capacity missing", { name: "Lab" }],
    ["capacity as string", { name: "Lab", capacity: "10" }],
    ["name missing", { capacity: 10 }],
    ["name as number", { name: 5, capacity: 10 }],
    ["array body", []],
    ["null body", null],
    ["number body", 5],
    ["string body", "Lab"],
  ])("answers 400 invalid_room for %s and creates no room", (_label, body) => {
    const store = createStore();
    const res = handleCreateRoom(store, val(body));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_room" });
    expect(list(store).body).toEqual({ rooms: [] });
  });

  it("answers 400 invalid_room for an absent body", () => {
    const store = createStore();
    const res = handleCreateRoom(store, { kind: "empty" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_room" });
    expect(list(store).body).toEqual({ rooms: [] });
  });

  it("accepts a whitespace-only name as a name of length 1 or more", () => {
    const res = handleCreateRoom(createStore(), val({ name: " ", capacity: 10 }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", name: " ", capacity: 10 });
  });
});

describe("room creation duplicate name (BEH-003)", () => {
  // @covers room-booking-api:BEH-003
  it.each([["lAb"], ["Lab"], ["LAB"]])("answers 409 room_name_taken for %s and creates no room", (name) => {
    const store = createStore();
    seed(store, [["Lab", 5]]);
    const res = handleCreateRoom(store, val({ name, capacity: 10 }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "room_name_taken" });
    expect(list(store).body).toEqual({ rooms: [{ id: "r1", name: "Lab", capacity: 5 }] });
  });

  it("accepts the differing name Lab 2 as room r2", () => {
    const store = createStore();
    seed(store, [["Lab", 5]]);
    const res = handleCreateRoom(store, val({ name: "Lab 2", capacity: 10 }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r2", name: "Lab 2", capacity: 10 });
  });

  it("answers invalid_room, never room_name_taken, for an empty name", () => {
    const store = createStore();
    seed(store, [["Lab", 5]]);
    const res = handleCreateRoom(store, val({ name: "", capacity: 10 }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_room" });
  });
});

describe("room creation invalid JSON (BEH-004)", () => {
  // @covers room-booking-api:BEH-004
  it.each([["{"], ["   "], ["\n"]])("answers 400 invalid_json for body %j and creates no room", (raw) => {
    const store = createStore();
    const res = handleCreateRoom(store, parseJsonBody(raw));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
    expect(list(store).body).toEqual({ rooms: [] });
  });

  it("answers invalid_json for an invalid body", () => {
    const store = createStore();
    const res = handleCreateRoom(store, { kind: "invalid" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
  });

  it.each([["[]"], ["null"]])("answers invalid_room, never invalid_json, for valid JSON %s", (raw) => {
    const res = handleCreateRoom(createStore(), parseJsonBody(raw));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_room" });
  });

  it("accepts the valid JSON body as room r1", () => {
    const res = handleCreateRoom(createStore(), parseJsonBody('{"name": "Lab", "capacity": 10}'));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", name: "Lab", capacity: 10 });
  });
});

describe("room list order (BEH-005)", () => {
  // @covers room-booking-api:BEH-005
  it("answers 200 with rooms r1, r2 and r3 in id order", () => {
    const store = createStore();
    seed(store, [["A", 4], ["B", 10], ["C", 10]]);
    const res = list(store);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rooms: [
        { id: "r1", name: "A", capacity: 4 },
        { id: "r2", name: "B", capacity: 10 },
        { id: "r3", name: "C", capacity: 10 },
      ],
    });
  });

  it("answers 200 with an empty rooms array on an empty store", () => {
    const res = list(createStore());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rooms: [] });
  });

  it("answers 200 with r1 only for one room", () => {
    const store = createStore();
    seed(store, [["A", 4]]);
    expect(list(store).body).toEqual({ rooms: [{ id: "r1", name: "A", capacity: 4 }] });
  });

  it("orders twelve rooms numerically so r2 precedes r10", () => {
    const store = createStore();
    for (let i = 1; i <= 12; i++) store.addRoom(`Room ${i}`, 10);
    const res = list(store);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12"]);
  });

  it("answers 400 invalid_query with no rooms array for minCapacity=0", () => {
    const store = createStore();
    seed(store, [["A", 4]]);
    const res = list(store, "minCapacity=0");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_query" });
  });
});

describe("room list minCapacity filter (BEH-006)", () => {
  const filled = (): Store => {
    const store = createStore();
    seed(store, [["A", 4], ["B", 10], ["C", 10]]);
    return store;
  };

  // @covers room-booking-api:BEH-006
  it("keeps r2 and r3 only for minCapacity=10", () => {
    const res = list(filled(), "minCapacity=10");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rooms: [
        { id: "r2", name: "B", capacity: 10 },
        { id: "r3", name: "C", capacity: 10 },
      ],
    });
  });

  it.each([
    ["", ["r1", "r2", "r3"]],
    ["minCapacity=1", ["r1", "r2", "r3"]],
    ["minCapacity=5", ["r2", "r3"]],
    ["minCapacity=100", []],
  ])("lists the rooms for query %j", (qs, expected) => {
    const res = list(filled(), qs);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(expected);
  });

  it.each([["abc"], ["0"], ["-1"], ["1.5"], [""]])("answers 400 invalid_query for minCapacity=%j", (value) => {
    const res = list(filled(), `minCapacity=${value}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_query" });
  });
});

describe("POST /rooms contract (CTR-001)", () => {
  // @covers room-booking-api:CTR-001
  it("answers only the declared statuses and codes and honours the code precedence", () => {
    const store = createStore();
    const created = handleCreateRoom(store, val({ name: "Lab", capacity: 10 }));
    expect(created.status).toBe(201);
    expect(Object.keys(created.body as object).sort()).toEqual(["capacity", "id", "name"]);

    const taken = handleCreateRoom(store, val({ name: "lAb", capacity: 10 }));
    expect([taken.status, taken.body]).toEqual([409, { error: "room_name_taken" }]);

    const takenBadCapacity = handleCreateRoom(store, val({ name: "lAb", capacity: 0 }));
    expect([takenBadCapacity.status, takenBadCapacity.body]).toEqual([400, { error: "invalid_room" }]);

    const badName = handleCreateRoom(store, val({ name: "", capacity: 10 }));
    expect([badName.status, badName.body]).toEqual([400, { error: "invalid_room" }]);

    const badJson = handleCreateRoom(store, parseJsonBody("{"));
    expect([badJson.status, badJson.body]).toEqual([400, { error: "invalid_json" }]);

    const blank = handleCreateRoom(store, parseJsonBody("  "));
    expect([blank.status, blank.body]).toEqual([400, { error: "invalid_json" }]);

    expect(list(store).body).toEqual({ rooms: [{ id: "r1", name: "Lab", capacity: 10 }] });
  });
});

describe("GET /rooms contract (CTR-002)", () => {
  // @covers room-booking-api:CTR-002
  it("answers 200, invalid_query or invalid_json only", () => {
    const store = createStore();
    seed(store, [["A", 4], ["B", 10]]);

    const all = list(store);
    expect(all.status).toBe(200);
    expect(ids(all)).toEqual(["r1", "r2"]);

    const some = list(store, "minCapacity=5");
    expect(some.status).toBe(200);
    expect(ids(some)).toEqual(["r2"]);

    const none = list(store, "minCapacity=100");
    expect([none.status, none.body]).toEqual([200, { rooms: [] }]);

    const zero = list(store, "minCapacity=0");
    expect([zero.status, zero.body]).toEqual([400, { error: "invalid_query" }]);

    const nan = list(store, "minCapacity=abc");
    expect([nan.status, nan.body]).toEqual([400, { error: "invalid_query" }]);

    const badBody = list(store, "", parseJsonBody("{"));
    expect([badBody.status, badBody.body]).toEqual([400, { error: "invalid_json" }]);
  });

  it("answers invalid_query before invalid_json when both apply", () => {
    const res = list(createStore(), "minCapacity=0", { kind: "invalid" });
    expect([res.status, res.body]).toEqual([400, { error: "invalid_query" }]);
  });
});
