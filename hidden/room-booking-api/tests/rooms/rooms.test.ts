import { describe, it, expect } from "vitest";
import { createStore } from "../../src/core/index.js";
import type { HandlerResponse, Route } from "../../src/core/index.js";
import { createRoomRoutes } from "../../src/rooms/index.js";

function setup() {
  const store = createStore();
  const routes: readonly Route[] = createRoomRoutes(store);
  const pick = (method: "GET" | "POST"): Route => {
    const route = routes.find((r) => r.method === method && r.path === "/rooms");
    if (!route) throw new Error(`no ${method} /rooms route`);
    return route;
  };
  const post = (body: unknown): HandlerResponse =>
    pick("POST").handle({ params: {}, query: new URLSearchParams(), body });
  const get = (query = ""): HandlerResponse =>
    pick("GET").handle({ params: {}, query: new URLSearchParams(query), body: undefined });
  return { store, routes, post, get };
}

const ROOM_NAMES = ["Aurora", "Borealis", "Cepheus", "Draco", "Eridanus", "Fornax", "Gemini", "Hydra", "Indus", "Jupiter", "Kepler"];

describe("room routes table", () => {
  it("declares POST /rooms expecting a JSON body and GET /rooms expecting none", () => {
    const { routes } = setup();
    const summary = routes.map((r) => `${r.method} ${r.path} ${r.expectsJsonBody}`).sort();
    expect(summary).toEqual(["GET /rooms false", "POST /rooms true"]);
  });
});

describe("POST /rooms creation", () => {
  // @covers room-booking-api:BEH-001
  it("answers 201 with the next room id and grows the store by one room", () => {
    const { store, post, get } = setup();
    post({ name: "R1", capacity: 1 });
    post({ name: "R2", capacity: 1 });
    post({ name: "R3", capacity: 1 });
    const res = post({ name: "Aurora", capacity: 10 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r4", name: "Aurora", capacity: 10 });
    expect(store.rooms()).toHaveLength(4);
    expect((get().body as { rooms: unknown[] }).rooms).toHaveLength(4);
  });

  it("answers r1 on an empty store and lists exactly one room afterwards", () => {
    const { post, get } = setup();
    expect(post({ name: "Aurora", capacity: 10 })).toEqual({
      status: 201,
      body: { id: "r1", name: "Aurora", capacity: 10 },
    });
    expect(get()).toEqual({ status: 200, body: { rooms: [{ id: "r1", name: "Aurora", capacity: 10 }] } });
  });

  it("answers r11 as the eleventh room, listed after r10", () => {
    const { post, get } = setup();
    for (let i = 0; i < 10; i++) post({ name: ROOM_NAMES[i], capacity: 10 });
    const res = post({ name: "Kepler", capacity: 10 });
    expect(res.status).toBe(201);
    expect((res.body as { id: string }).id).toBe("r11");
    const ids = (get().body as { rooms: { id: string }[] }).rooms.map((r) => r.id);
    expect(ids.slice(-2)).toEqual(["r10", "r11"]);
  });

  it("drops an extra member from the response and from later listings", () => {
    const { post, get } = setup();
    const res = post({ name: "Borealis", capacity: 10, floor: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", name: "Borealis", capacity: 10 });
    expect(Object.keys(res.body as object).sort()).toEqual(["capacity", "id", "name"]);
    expect(get().body).toEqual({ rooms: [{ id: "r1", name: "Borealis", capacity: 10 }] });
  });

  it("rejects capacity 0 with invalid_room and adds no room", () => {
    const { store, post } = setup();
    expect(post({ name: "Aurora", capacity: 0 })).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(store.rooms()).toHaveLength(0);
  });
});

describe("POST /rooms name rules", () => {
  // @covers room-booking-api:BEH-002
  it("accepts a name of exactly 40 characters and rejects 41 with invalid_room", () => {
    const { store, post } = setup();
    const forty = "A".repeat(40);
    expect(post({ name: forty, capacity: 10 })).toEqual({
      status: 201,
      body: { id: "r1", name: forty, capacity: 10 },
    });
    expect(post({ name: "A".repeat(41), capacity: 10 })).toEqual({
      status: 400,
      body: { error: "invalid_room" },
    });
    expect(store.rooms()).toHaveLength(1);
  });

  it.each([
    ["empty string", { name: "", capacity: 10 }],
    ["absent name", { capacity: 10 }],
    ["numeric name", { name: 42, capacity: 10 }],
    ["null name", { name: null, capacity: 10 }],
    ["boolean name", { name: true, capacity: 10 }],
  ])("rejects a %s with invalid_room and leaves the store unchanged", (_label, body) => {
    const { store, post, get } = setup();
    post({ name: "Existing", capacity: 5 });
    expect(post(body)).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(store.rooms()).toHaveLength(1);
    expect((get().body as { rooms: unknown[] }).rooms).toHaveLength(1);
  });

  it("creates a whitespace-only name verbatim without trimming", () => {
    const { post, get } = setup();
    expect(post({ name: " ", capacity: 10 })).toEqual({
      status: 201,
      body: { id: "r1", name: " ", capacity: 10 },
    });
    expect(get().body).toEqual({ rooms: [{ id: "r1", name: " ", capacity: 10 }] });
  });

  it.each([
    ["an array", [{ name: "Aurora", capacity: 10 }]],
    ["null", null],
    ["a string", "Aurora"],
    ["a number", 7],
    ["undefined", undefined],
  ])("rejects a body that is %s with invalid_room", (_label, body) => {
    const { store, post } = setup();
    expect(post(body)).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(store.rooms()).toHaveLength(0);
  });

  it("checks the name before the capacity and the capacity before the name uniqueness", () => {
    const { post } = setup();
    post({ name: "Aurora", capacity: 10 });
    expect(post({ name: "aurora", capacity: 0 })).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(post({ name: "aurora", capacity: 10 })).toEqual({ status: 409, body: { error: "room_name_taken" } });
  });
});

describe("POST /rooms capacity rules", () => {
  // @covers room-booking-api:BEH-003
  it.each([
    [1, "r1"],
    [100, "r1"],
  ])("accepts capacity %i and echoes it unchanged", (capacity, id) => {
    const { post } = setup();
    expect(post({ name: "Aurora", capacity })).toEqual({ status: 201, body: { id, name: "Aurora", capacity } });
  });

  it.each([
    ["0", 0],
    ["101", 101],
    ["-1", -1],
    ["2.5", 2.5],
    ["numeric string", "10"],
    ["null", null],
    ["boolean", true],
  ])("rejects capacity %s with invalid_room and adds no room", (_label, capacity) => {
    const { store, post } = setup();
    expect(post({ name: "Aurora", capacity })).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(store.rooms()).toHaveLength(0);
  });

  it("rejects an absent capacity with invalid_room and adds no default-capacity room", () => {
    const { store, post, get } = setup();
    expect(post({ name: "Fornax" })).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(store.rooms()).toHaveLength(0);
    expect(get().body).toEqual({ rooms: [] });
  });
});

describe("POST /rooms name uniqueness", () => {
  // @covers room-booking-api:BEH-004
  it.each([["Aurora"], ["aurora"], ["AURORA"]])(
    "rejects the name %s while Aurora exists with room_name_taken and keeps the room unchanged",
    (name) => {
      const { store, post, get } = setup();
      post({ name: "Aurora", capacity: 4 });
      expect(post({ name, capacity: 20 })).toEqual({ status: 409, body: { error: "room_name_taken" } });
      expect(store.rooms()).toHaveLength(1);
      expect(get().body).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 4 }] });
    },
  );

  it("accepts the distinct name Borealis with the next room id", () => {
    const { post } = setup();
    post({ name: "Aurora", capacity: 4 });
    expect(post({ name: "Borealis", capacity: 10 })).toEqual({
      status: 201,
      body: { id: "r2", name: "Borealis", capacity: 10 },
    });
  });
});

describe("GET /rooms listing", () => {
  // @covers room-booking-api:BEH-005
  it("lists every room once in id order, each carrying exactly id, name and capacity", () => {
    const { post, get } = setup();
    post({ name: "Aurora", capacity: 4 });
    post({ name: "Borealis", capacity: 10 });
    post({ name: "Cepheus", capacity: 10 });
    const res = get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rooms: [
        { id: "r1", name: "Aurora", capacity: 4 },
        { id: "r2", name: "Borealis", capacity: 10 },
        { id: "r3", name: "Cepheus", capacity: 10 },
      ],
    });
  });

  it("answers an object with an empty rooms array on an empty store", () => {
    const { get } = setup();
    expect(get()).toEqual({ status: 200, body: { rooms: [] } });
  });

  it("lists r2 before r10 with ten rooms in creation order", () => {
    const { post, get } = setup();
    for (let i = 0; i < 10; i++) post({ name: ROOM_NAMES[i], capacity: 10 });
    const ids = (get().body as { rooms: { id: string }[] }).rooms.map((r) => r.id);
    expect(ids).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"]);
  });

  it("rejects minCapacity=0 with invalid_query instead of listing every room", () => {
    const { post, get } = setup();
    post({ name: "Aurora", capacity: 4 });
    expect(get("minCapacity=0")).toEqual({ status: 400, body: { error: "invalid_query" } });
  });
});

describe("GET /rooms minCapacity filter", () => {
  function seeded() {
    const s = setup();
    s.post({ name: "Aurora", capacity: 4 });
    s.post({ name: "Borealis", capacity: 10 });
    s.post({ name: "Cepheus", capacity: 10 });
    return s;
  }
  const ids = (res: HandlerResponse) => (res.body as { rooms: { id: string }[] }).rooms.map((r) => r.id);

  // @covers room-booking-api:BEH-006
  it("returns only the two capacity-10 rooms in id order for minCapacity=10", () => {
    const res = seeded().get("minCapacity=10");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rooms: [
        { id: "r2", name: "Borealis", capacity: 10 },
        { id: "r3", name: "Cepheus", capacity: 10 },
      ],
    });
  });

  it("includes a room whose capacity equals minCapacity", () => {
    expect(ids(seeded().get("minCapacity=4"))).toEqual(["r1", "r2", "r3"]);
  });

  it("answers an empty rooms array when minCapacity exceeds every capacity", () => {
    expect(seeded().get("minCapacity=101")).toEqual({ status: 200, body: { rooms: [] } });
  });

  it("answers an empty rooms array for minCapacity=1 on an empty store", () => {
    expect(setup().get("minCapacity=1")).toEqual({ status: 200, body: { rooms: [] } });
  });

  it("returns all three rooms for minCapacity=1", () => {
    expect(ids(seeded().get("minCapacity=1"))).toEqual(["r1", "r2", "r3"]);
  });

  it("rejects minCapacity=abc with invalid_query", () => {
    expect(seeded().get("minCapacity=abc")).toEqual({ status: 400, body: { error: "invalid_query" } });
  });
});

describe("GET /rooms minCapacity validation", () => {
  // @covers room-booking-api:BEH-007
  it.each([["0"], ["-1"], ["2.5"], ["abc"], [""]])(
    "rejects minCapacity=%s with invalid_query and still lists rooms without a query",
    (value) => {
      const { post, get } = setup();
      post({ name: "Aurora", capacity: 4 });
      expect(get(`minCapacity=${value}`)).toEqual({ status: 400, body: { error: "invalid_query" } });
      expect(get().status).toBe(200);
    },
  );

  it("accepts minCapacity=3 and returns both rooms of capacity 4 and 10", () => {
    const { post, get } = setup();
    post({ name: "Aurora", capacity: 4 });
    post({ name: "Borealis", capacity: 10 });
    expect(get("minCapacity=3")).toEqual({
      status: 200,
      body: {
        rooms: [
          { id: "r1", name: "Aurora", capacity: 4 },
          { id: "r2", name: "Borealis", capacity: 10 },
        ],
      },
    });
  });
});

describe("POST /rooms contract", () => {
  // @covers room-booking-api:CTR-001
  it("answers 201 with exactly id, name and capacity and each invalid class with its own code", () => {
    const { post } = setup();
    const ok = post({ name: "Aurora", capacity: 10 });
    expect(ok.status).toBe(201);
    expect(Object.keys(ok.body as object).sort()).toEqual(["capacity", "id", "name"]);
    expect(post({ name: "Aurora" })).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(post({ name: "", capacity: 10 })).toEqual({ status: 400, body: { error: "invalid_room" } });
    expect(post({ name: "aurora", capacity: 10 })).toEqual({ status: 409, body: { error: "room_name_taken" } });
  });
});

describe("GET /rooms contract", () => {
  // @covers room-booking-api:CTR-002
  it("answers 200 with exactly the member rooms, filtered and ordered by id, and invalid_query for minCapacity=0", () => {
    const { post, get } = setup();
    post({ name: "Aurora", capacity: 4 });
    post({ name: "Borealis", capacity: 10 });
    const all = get();
    expect(all.status).toBe(200);
    expect(Object.keys(all.body as object)).toEqual(["rooms"]);
    expect(get("minCapacity=4").body).toEqual({
      rooms: [
        { id: "r1", name: "Aurora", capacity: 4 },
        { id: "r2", name: "Borealis", capacity: 10 },
      ],
    });
    expect(get("minCapacity=0")).toEqual({ status: 400, body: { error: "invalid_query" } });
  });
});

describe("room id sequence scenario", () => {
  // @covers room-booking-api:SCN-001
  it("assigns r1 then r2, lists r1 before r2 and answers a retried Aurora with room_name_taken", () => {
    const { post, get } = setup();
    expect(post({ name: "Aurora", capacity: 4 })).toEqual({
      status: 201,
      body: { id: "r1", name: "Aurora", capacity: 4 },
    });
    expect(post({ name: "Borealis", capacity: 10 })).toEqual({
      status: 201,
      body: { id: "r2", name: "Borealis", capacity: 10 },
    });
    expect(post({ name: "Aurora", capacity: 4 })).toEqual({ status: 409, body: { error: "room_name_taken" } });
    expect(get()).toEqual({
      status: 200,
      body: {
        rooms: [
          { id: "r1", name: "Aurora", capacity: 4 },
          { id: "r2", name: "Borealis", capacity: 10 },
        ],
      },
    });
  });
});
