import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createStore } from "../../src/domain/index.js";
import { resolvePort, startServer } from "../../src/index.js";

const ROOM = JSON.stringify({ name: "Aurora", capacity: 4 });
const BOOKING = JSON.stringify({
  title: "Standup",
  start: "2026-01-05T09:00:00Z",
  end: "2026-01-05T10:00:00Z",
  attendees: 2,
});

interface Reply {
  status: number;
  type: string | null;
  text: string;
  json: unknown;
}

async function withServer(fn: (call: (method: string, path: string, body?: string) => Promise<Reply>) => Promise<void>): Promise<void> {
  const server = await startServer(createStore(), 0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await fn(async (method, path, body) => {
      const res = await fetch(base + path, { method, body });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: res.status, type: res.headers.get("content-type"), text, json };
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

describe("http server routing and boundary validation", () => {
  // @covers room-booking-api:BEH-019
  it("a POST /rooms body that is truncated, empty or not an object answers 400 invalid_json and the server keeps serving", async () => {
    await withServer(async (call) => {
      for (const body of ['{"name":', undefined, "[1,2,3]"]) {
        const res = await call("POST", "/rooms", body);
        expect(res.status).toBe(400);
        expect(res.json).toEqual({ error: "invalid_json" });
        const list = await call("GET", "/rooms");
        expect(list.status).toBe(200);
        expect(list.json).toEqual({ rooms: [] });
      }
      const created = await call("POST", "/rooms", ROOM);
      expect(created.status).toBe(201);
      expect(created.json).toEqual({ id: "r1", name: "Aurora", capacity: 4 });
    });
  });

  it("a POST body of valid JSON that is a string, number, boolean or null answers 400 invalid_json on both POST routes", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", ROOM);
      for (const body of ['"text"', "42", "true", "null"]) {
        const room = await call("POST", "/rooms", body);
        expect(room.status).toBe(400);
        expect(room.json).toEqual({ error: "invalid_json" });
        const booking = await call("POST", "/rooms/r1/bookings", body);
        expect(booking.status).toBe(400);
        expect(booking.json).toEqual({ error: "invalid_json" });
      }
      const unparsable = await call("POST", "/rooms/r1/bookings", '{"title":');
      expect(unparsable.status).toBe(400);
      expect(unparsable.json).toEqual({ error: "invalid_json" });
      expect((await call("GET", "/rooms")).json).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 4 }] });
      expect((await call("GET", "/rooms/r1/bookings")).json).toEqual({ bookings: [] });
    });
  });

  // @covers room-booking-api:BEH-020
  it("a request to a path outside the endpoint set answers 404 not_found", async () => {
    await withServer(async (call) => {
      const probes: Array<[string, string]> = [
        ["GET", "/rooms/r1"],
        ["GET", "/booking"],
        ["DELETE", "/rooms/r1"],
        ["GET", "/rooms/r1/bookings/extra"],
        ["GET", "/rooms/"],
        ["GET", "/"],
      ];
      for (const [method, path] of probes) {
        const res = await call(method, path);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.json, `${method} ${path}`).toEqual({ error: "not_found" });
      }
      const rooms = await call("GET", "/rooms");
      expect(rooms.status).toBe(200);
      expect(rooms.json).toEqual({ rooms: [] });
    });
  });

  // @covers room-booking-api:BEH-021
  it("an unsupported method on a defined path answers 405 method_not_allowed, changes no state, and an undefined path answers 404", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", ROOM);
      await call("POST", "/rooms/r1/bookings", BOOKING);
      const rooms = (await call("GET", "/rooms")).json;
      const bookings = (await call("GET", "/rooms/r1/bookings")).json;
      const probes: Array<[string, string, string | undefined]> = [
        ["DELETE", "/rooms", undefined],
        ["PUT", "/rooms", ROOM],
        ["PATCH", "/rooms/r1/bookings", ""],
        ["DELETE", "/rooms/r1/bookings", undefined],
        ["GET", "/bookings/b1", undefined],
        ["POST", "/bookings/b1", BOOKING],
        ["POST", "/availability", ""],
        ["DELETE", "/availability", undefined],
      ];
      for (const [method, path, body] of probes) {
        const res = await call(method, path, body);
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.json, `${method} ${path}`).toEqual({ error: "method_not_allowed" });
      }
      expect((await call("GET", "/rooms")).json).toEqual(rooms);
      expect((await call("GET", "/rooms/r1/bookings")).json).toEqual(bookings);
      const missing = await call("GET", "/nope");
      expect(missing.status).toBe(404);
      expect(missing.json).toEqual({ error: "not_found" });
    });
  });

  // @covers room-booking-api:BEH-022
  it("every response other than 204 carries Content-Type application/json and the 204 carries no body and no content type", async () => {
    await withServer(async (call) => {
      const cases: Array<[string, string, string | undefined, number, unknown]> = [
        ["POST", "/rooms", ROOM, 201, { id: "r1", name: "Aurora", capacity: 4 }],
        ["GET", "/rooms", undefined, 200, { rooms: [{ id: "r1", name: "Aurora", capacity: 4 }] }],
        ["POST", "/rooms", '{"name":"","capacity":1}', 400, { error: "invalid_room" }],
        ["POST", "/rooms", '{"name":', 400, { error: "invalid_json" }],
        ["GET", "/rooms/r9", undefined, 404, { error: "not_found" }],
        ["DELETE", "/rooms", undefined, 405, { error: "method_not_allowed" }],
        ["POST", "/rooms", '{"name":"aurora","capacity":4}', 409, { error: "room_name_taken" }],
        ["POST", "/rooms", '{"name":"Borealis","capacity":4}', 201, { id: "r2", name: "Borealis", capacity: 4 }],
        [
          "POST",
          "/rooms/r2/bookings",
          JSON.stringify({ title: "Offsite", start: "2026-01-05T09:00:00Z", end: "2026-01-05T10:00:00Z", attendees: 5 }),
          422,
          { error: "over_capacity" },
        ],
        ["DELETE", "/bookings/b9", undefined, 404, { error: "booking_not_found" }],
      ];
      for (const [method, path, body, status, json] of cases) {
        const res = await call(method, path, body);
        expect(res.status, `${method} ${path}`).toBe(status);
        expect(res.type, `${method} ${path}`).toMatch(/^application\/json/);
        expect(res.json, `${method} ${path}`).toEqual(json);
      }
      const booked = await call("POST", "/rooms/r1/bookings", BOOKING);
      expect(booked.status).toBe(201);
      expect(booked.type).toMatch(/^application\/json/);
      const removed = await call("DELETE", "/bookings/b1");
      expect(removed.status).toBe(204);
      expect(removed.text).toBe("");
      expect(removed.type).toBeNull();
    });
  });

  // @covers room-booking-api:POL-002
  it("an invalid body, query parameter or path parameter answers its documented 4xx code, changes no state and the server keeps serving", async () => {
    await withServer(async (call) => {
      expect((await call("POST", "/rooms", ROOM)).status).toBe(201);
      const probes: Array<[string, string, string | undefined, number, string]> = [
        ["POST", "/rooms", '{"name":', 400, "invalid_json"],
        ["GET", "/rooms?minCapacity=0", undefined, 400, "invalid_query"],
        ["POST", "/rooms/r99/bookings", BOOKING, 404, "room_not_found"],
        ["GET", "/rooms/r99/bookings", undefined, 404, "room_not_found"],
      ];
      for (const [method, path, body, status, code] of probes) {
        const res = await call(method, path, body);
        expect(res.status, `${method} ${path}`).toBe(status);
        expect(res.json, `${method} ${path}`).toEqual({ error: code });
        const list = await call("GET", "/rooms");
        expect(list.status).toBe(200);
        expect(list.json).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 4 }] });
      }
      expect((await call("GET", "/rooms/r1/bookings")).json).toEqual({ bookings: [] });
    });
  });

  it("resolvePort returns the PORT value when it is an integer in 1..65535 and 3000 otherwise", () => {
    expect(resolvePort({})).toBe(3000);
    expect(resolvePort({ PORT: "8080" })).toBe(8080);
    expect(resolvePort({ PORT: "1" })).toBe(1);
    expect(resolvePort({ PORT: "65535" })).toBe(65535);
    for (const bad of ["0", "65536", "-1", "abc", "", "80.5"]) {
      expect(resolvePort({ PORT: bad }), bad).toBe(3000);
    }
  });
});
