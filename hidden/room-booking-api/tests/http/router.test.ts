import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createRouter } from "../../src/http/index.js";
import type { Route, RouteResult } from "../../src/http/index.js";

interface Fixture {
  routes: Route[];
  rooms: { id: string; name: string; capacity: number }[];
  bookings: { id: string; roomId: string; title: string; attendees: number }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeFixture(): Fixture {
  const rooms: Fixture["rooms"] = [{ id: "r1", name: "Atlas", capacity: 6 }];
  const bookings: Fixture["bookings"] = [{ id: "b1", roomId: "r1", title: "Sync", attendees: 2 }];
  const routes: Route[] = [
    {
      method: "POST",
      path: "/rooms",
      handle: ({ body }): RouteResult => {
        if (!isRecord(body)) return { kind: "error", error: { error: "invalid_json" } };
        const { name, capacity } = body;
        if (typeof name !== "string" || name.trim() === "") return { kind: "error", error: { error: "invalid_room" } };
        if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
          return { kind: "error", error: { error: "invalid_room" } };
        }
        if (rooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
          return { kind: "error", error: { error: "room_name_taken" } };
        }
        const room = { id: `r${rooms.length + 1}`, name, capacity };
        rooms.push(room);
        return { kind: "ok", status: 201, body: room };
      },
    },
    {
      method: "GET",
      path: "/rooms",
      handle: ({ query }): RouteResult => {
        const min = query.get("minCapacity");
        if (min !== null && !/^[0-9]+$/.test(min)) return { kind: "error", error: { error: "invalid_query" } };
        return { kind: "ok", status: 200, body: rooms.filter((r) => r.capacity >= Number(min ?? 0)) };
      },
    },
    {
      method: "POST",
      path: "/rooms/:roomId/bookings",
      handle: ({ params, body }): RouteResult => {
        const room = rooms.find((r) => r.id === params["roomId"]);
        if (!room) return { kind: "error", error: { error: "room_not_found" } };
        if (!isRecord(body)) return { kind: "error", error: { error: "invalid_json" } };
        const { title, attendees } = body;
        if (typeof title !== "string" || typeof attendees !== "number") {
          return { kind: "error", error: { error: "invalid_booking" } };
        }
        if (attendees > room.capacity) return { kind: "error", error: { error: "over_capacity" } };
        if (title === "clash") return { kind: "error", error: { error: "room_busy", conflictingBookingId: "b1" } };
        const booking = { id: `b${bookings.length + 1}`, roomId: room.id, title, attendees };
        bookings.push(booking);
        return { kind: "ok", status: 201, body: booking };
      },
    },
    {
      method: "GET",
      path: "/rooms/:roomId/bookings",
      handle: ({ params }): RouteResult => {
        if (!rooms.some((r) => r.id === params["roomId"])) return { kind: "error", error: { error: "room_not_found" } };
        return { kind: "ok", status: 200, body: bookings.filter((b) => b.roomId === params["roomId"]) };
      },
    },
    {
      method: "DELETE",
      path: "/bookings/:bookingId",
      handle: ({ params }): RouteResult => {
        const index = bookings.findIndex((b) => b.id === params["bookingId"]);
        if (index < 0) return { kind: "error", error: { error: "booking_not_found" } };
        bookings.splice(index, 1);
        return { kind: "ok", status: 204 };
      },
    },
    { method: "GET", path: "/availability", handle: (): RouteResult => ({ kind: "ok", status: 200, body: [] }) },
  ];
  return { routes, rooms, bookings };
}

async function serve(fixture: Fixture, run: (base: string) => Promise<void>): Promise<void> {
  const server = createServer(createRouter(fixture.routes));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

interface Reply {
  status: number;
  contentType: string | null;
  text: string;
  json: unknown;
}

async function send(base: string, method: string, path: string, body?: string): Promise<Reply> {
  const response = await fetch(base + path, body === undefined ? { method } : { method, body });
  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, contentType: response.headers.get("content-type"), text, json };
}

const ROOMS_AT_START = [{ id: "r1", name: "Atlas", capacity: 6 }];

async function expectStillServing(base: string): Promise<void> {
  const after = await send(base, "GET", "/rooms");
  expect(after.status).toBe(200);
  expect(after.json).toEqual(ROOMS_AT_START);
}

describe("room-booking-api http router: malformed JSON body", () => {
  it("creates a Room from a valid JSON body with 201", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "POST", "/rooms", '{ "name": "Focus", "capacity": 6 }');
      expect(reply.status).toBe(201);
      expect(reply.json).toEqual({ id: "r2", name: "Focus", capacity: 6 });
    });
  });

  // @covers room-booking-api:BEH-021
  it.each([
    ["empty body", ""],
    ["truncated JSON", '{ "name": "Focus", "capacity":'],
    ["JSON array instead of object", "[]"],
  ])("answers 400 invalid_json for POST /rooms with %s and leaves the Room list unchanged", async (_label, body) => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "POST", "/rooms", body);
      expect(reply.status).toBe(400);
      expect(reply.json).toEqual({ error: "invalid_json" });
      await expectStillServing(base);
    });
  });

  it("answers 400 invalid_json for POST /rooms/r1/bookings with body { and stores no Booking", async () => {
    const fixture = makeFixture();
    await serve(fixture, async (base) => {
      const reply = await send(base, "POST", "/rooms/r1/bookings", "{");
      expect(reply.status).toBe(400);
      expect(reply.json).toEqual({ error: "invalid_json" });
      expect(fixture.bookings).toHaveLength(1);
      await expectStillServing(base);
    });
  });

  it("answers an unparseable body with Content-Type application/json", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "POST", "/rooms", "");
      expect(reply.status).toBe(400);
      expect(reply.contentType).toMatch(/^application\/json/);
    });
  });

  it("answers valid JSON failing validation with 400 invalid_room, not invalid_json", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "POST", "/rooms", '{ "name": "", "capacity": 6 }');
      expect(reply.status).toBe(400);
      expect(reply.json).toEqual({ error: "invalid_room" });
    });
  });
});

describe("room-booking-api http router: unknown route", () => {
  it("routes GET /rooms to its handler with 200", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "GET", "/rooms");
      expect(reply.status).toBe(200);
      expect(reply.json).toEqual(ROOMS_AT_START);
    });
  });

  it("captures :roomId into params for GET /rooms/r1/bookings", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "GET", "/rooms/r1/bookings");
      expect(reply.status).toBe(200);
      expect(reply.json).toEqual([{ id: "b1", roomId: "r1", title: "Sync", attendees: 2 }]);
    });
  });

  // @covers room-booking-api:BEH-022
  it.each([
    ["GET", "/rooms/r1", undefined],
    ["GET", "/bookings", undefined],
    ["GET", "/status", undefined],
    ["DELETE", "/health", undefined],
    ["POST", "/rooms/r1/bookings/x", "{}"],
    ["GET", "/rooms/r1/bookings/x", undefined],
    ["DELETE", "/", undefined],
  ])("answers %s %s with 404 not_found and keeps serving", async (method, path, body) => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, method, path, body);
      expect(reply.status).toBe(404);
      expect(reply.json).toEqual({ error: "not_found" });
      expect(reply.contentType).toMatch(/^application\/json/);
      await expectStillServing(base);
    });
  });
});

describe("room-booking-api http router: unsupported method", () => {
  // @covers room-booking-api:BEH-023
  it.each([
    ["DELETE", "/rooms", undefined],
    ["PUT", "/rooms/r1/bookings", "{}"],
    ["POST", "/availability", "{}"],
    ["GET", "/bookings/b1", undefined],
    ["PUT", "/rooms", "{}"],
  ])("answers %s %s with 405 method_not_allowed and leaves state unchanged", async (method, path, body) => {
    const fixture = makeFixture();
    await serve(fixture, async (base) => {
      const reply = await send(base, method, path, body);
      expect(reply.status).toBe(405);
      expect(reply.json).toEqual({ error: "method_not_allowed" });
      expect(reply.contentType).toMatch(/^application\/json/);
      expect(fixture.bookings).toHaveLength(1);
      await expectStillServing(base);
    });
  });

  it("answers PATCH /rooms/r1 with 404 not_found because no documented route matches the path", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "PATCH", "/rooms/r1", "{}");
      expect(reply.status).toBe(404);
      expect(reply.json).toEqual({ error: "not_found" });
    });
  });

  it("still answers a documented method on the same path after a 405", async () => {
    await serve(makeFixture(), async (base) => {
      expect((await send(base, "DELETE", "/rooms")).status).toBe(405);
      const listed = await send(base, "GET", "/rooms");
      expect(listed.status).toBe(200);
      const deleted = await send(base, "DELETE", "/bookings/b1");
      expect(deleted.status).toBe(204);
    });
  });
});

describe("room-booking-api http router: JSON content type", () => {
  // @covers room-booking-api:BEH-024
  it("sets Content-Type application/json on a 200 and sends no body on the 204 of DELETE /bookings/b1", async () => {
    await serve(makeFixture(), async (base) => {
      const listed = await send(base, "GET", "/rooms");
      expect(listed.status).toBe(200);
      expect(listed.contentType).toMatch(/^application\/json/);
      expect(listed.json).toEqual(ROOMS_AT_START);

      const deleted = await send(base, "DELETE", "/bookings/b1");
      expect(deleted.status).toBe(204);
      expect(deleted.text).toBe("");
      expect(deleted.contentType).toBeNull();
    });
  });

  it("sets Content-Type application/json on a 400 invalid_query for GET /rooms?minCapacity=abc", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "GET", "/rooms?minCapacity=abc");
      expect(reply.status).toBe(400);
      expect(reply.contentType).toMatch(/^application\/json/);
      expect(reply.json).toEqual({ error: "invalid_query" });
    });
  });

  it("sets Content-Type application/json on a 201 creation", async () => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, "POST", "/rooms", '{ "name": "Focus", "capacity": 6 }');
      expect(reply.status).toBe(201);
      expect(reply.contentType).toMatch(/^application\/json/);
    });
  });

  it.each([
    ["POST", "/rooms", '{ "name": "ATLAS", "capacity": 6 }', 409, { error: "room_name_taken" }],
    ["GET", "/rooms/r9/bookings", undefined, 404, { error: "room_not_found" }],
    ["DELETE", "/bookings/b9", undefined, 404, { error: "booking_not_found" }],
    ["POST", "/rooms/r1/bookings", '{ "title": "x", "attendees": 7 }', 422, { error: "over_capacity" }],
    [
      "POST",
      "/rooms/r1/bookings",
      '{ "title": "clash", "attendees": 2 }',
      409,
      { error: "room_busy", conflictingBookingId: "b1" },
    ],
  ])("writes the ApiError of %s %s as a JSON body with its status", async (method, path, body, status, expected) => {
    await serve(makeFixture(), async (base) => {
      const reply = await send(base, method, path, body);
      expect(reply.status).toBe(status);
      expect(reply.contentType).toMatch(/^application\/json/);
      expect(reply.json).toEqual(expected);
    });
  });
});

describe("room-booking-api http router: input validation keeps the process alive", () => {
  // @covers room-booking-api:POL-002
  it.each([
    ["malformed JSON body", "POST", "/rooms", "{", 400, "invalid_json"],
    ["wrong field type", "POST", "/rooms", '{ "name": "Focus", "capacity": "six" }', 400, "invalid_room"],
    ["capacity above range", "POST", "/rooms", '{ "name": "Focus", "capacity": 101 }', 400, "invalid_room"],
    ["capacity below range", "POST", "/rooms", '{ "name": "Focus", "capacity": 0 }', 400, "invalid_room"],
    ["non-integer capacity", "POST", "/rooms", '{ "name": "Focus", "capacity": 2.5 }', 400, "invalid_room"],
    ["invalid query parameter", "GET", "/rooms?minCapacity=abc", undefined, 400, "invalid_query"],
    ["attendees above capacity", "POST", "/rooms/r1/bookings", '{ "title": "x", "attendees": 7 }', 422, "over_capacity"],
  ])("answers %s with its documented status and then keeps serving", async (_label, method, path, body, status, code) => {
    const fixture = makeFixture();
    await serve(fixture, async (base) => {
      const reply = await send(base, method, path, body);
      expect(reply.status).toBe(status);
      expect(reply.json).toEqual({ error: code });
      expect(reply.text).not.toContain("at ");
      expect(fixture.rooms).toEqual(ROOMS_AT_START);
      expect(fixture.bookings).toHaveLength(1);
      await expectStillServing(base);
    });
  });
});
