import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { buildServer } from "../../src/app/index.js";

const ROOM = { name: "Aurora", capacity: 10 };
const BOOKING = {
  title: "Standup",
  start: "2026-11-02T09:00:00Z",
  end: "2026-11-02T10:00:00Z",
  attendees: 5,
};

type Call = (method: string, path: string, body?: string) => Promise<Response>;

async function withServer(fn: (call: Call) => Promise<void>): Promise<void> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call: Call = (method, path, body) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method, body });
  try {
    await fn(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const json = (value: unknown): string => JSON.stringify(value);

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(await res.json()).toEqual({ error: code });
}

describe("HTTP surface routing", () => {
  // @covers room-booking-api:BEH-025
  it("answers invalid_json for an unparseable body and the validation code for a JSON value that is not an object", async () => {
    await withServer(async (call) => {
      const created = await call("POST", "/rooms", json(ROOM));
      expect(created.status).toBe(201);
      await expectError(await call("POST", "/rooms", '{"name": "Aurora",'), 400, "invalid_json");
      await expectError(await call("POST", "/rooms/r1/bookings", ""), 400, "invalid_json");
      await expectError(await call("POST", "/rooms", "[]"), 400, "invalid_room");
      await expectError(await call("POST", "/rooms/r1/bookings", '"Standup"'), 400, "invalid_booking");
    });
  });

  it.each([
    ["POST", "/rooms", '{"name": "Aurora",'],
    ["POST", "/rooms", ""],
    ["POST", "/rooms", "Aurora"],
    ["POST", "/rooms/r1/bookings", '{"title": "Standup", "start":'],
    ["POST", "/rooms/r1/bookings", ""],
  ])("answers invalid_json, never 500, for %s %s with body %j", async (method, path, body) => {
    await withServer(async (call) => {
      await call("POST", "/rooms", json(ROOM));
      await expectError(await call(method, path, body), 400, "invalid_json");
    });
  });

  // @covers room-booking-api:BEH-026
  it("answers not_found for a path matching no listed endpoint and still serves GET /rooms", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", json(ROOM));
      await call("POST", "/rooms/r1/bookings", json(BOOKING));
      await expectError(await call("GET", "/nope"), 404, "not_found");
      await expectError(await call("GET", "/bookings"), 404, "not_found");
      await expectError(await call("GET", "/rooms/"), 404, "not_found");
      await expectError(await call("DELETE", "/rooms/r1"), 404, "not_found");
      const listed = await call("GET", "/rooms");
      expect(listed.status).toBe(200);
    });
  });

  it("answers GET /availability with 200 or invalid_query, never not_found", async () => {
    await withServer(async (call) => {
      const res = await call("GET", "/availability");
      expect([200, 400]).toContain(res.status);
      const body = (await res.json()) as { error?: string };
      expect(body.error).not.toBe("not_found");
      if (res.status === 400) expect(body).toEqual({ error: "invalid_query" });
    });
  });

  // @covers room-booking-api:BEH-027
  it("answers method_not_allowed for a listed path with an unlisted method and never rejects a listed method", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", json(ROOM));
      await expectError(await call("PUT", "/rooms", ""), 405, "method_not_allowed");
      await expectError(await call("PATCH", "/rooms/r1/bookings", ""), 405, "method_not_allowed");
      await expectError(await call("POST", "/availability", ""), 405, "method_not_allowed");
      await expectError(await call("DELETE", "/rooms", ""), 405, "method_not_allowed");
      const listed = await call("POST", "/rooms", json({ name: "Borealis", capacity: 4 }));
      expect(listed.status).toBe(201);
    });
  });

  // @covers room-booking-api:CTR-007
  it("serves invalid_json, not_found, method_not_allowed and room_busy as JSON bodies with exactly the documented members", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", json(ROOM));
      await call("POST", "/rooms/r1/bookings", json(BOOKING));
      await expectError(await call("POST", "/rooms", "Aurora"), 400, "invalid_json");
      await expectError(await call("GET", "/nope"), 404, "not_found");
      await expectError(await call("PUT", "/rooms", ""), 405, "method_not_allowed");
      const busy = await call(
        "POST",
        "/rooms/r1/bookings",
        json({ ...BOOKING, start: "2026-11-02T09:30:00Z", end: "2026-11-02T10:30:00Z" }),
      );
      expect(busy.status).toBe(409);
      expect(busy.headers.get("content-type")).toBe("application/json");
      expect(await busy.json()).toEqual({ error: "room_busy", conflictingBookingId: "b1" });
    });
  });

  // @covers room-booking-api:INV-004
  it("serves success and error responses as application/json and a 204 with no body", async () => {
    await withServer(async (call) => {
      const created = await call("POST", "/rooms", json(ROOM));
      expect(created.status).toBe(201);
      expect(created.headers.get("content-type")).toBe("application/json");
      await call("POST", "/rooms/r1/bookings", json(BOOKING));
      await expectError(await call("GET", "/rooms?minCapacity=0"), 400, "invalid_query");
      const removed = await call("DELETE", "/bookings/b1");
      expect(removed.status).toBe(204);
      expect(await removed.text()).toBe("");
    });
  });

  // @covers room-booking-api:POL-002
  it("still serves GET /rooms after a malformed body on POST /rooms", async () => {
    await withServer(async (call) => {
      await expectError(await call("POST", "/rooms", '{"name": "Aurora",'), 400, "invalid_json");
      const next = await call("GET", "/rooms");
      expect(next.status).toBe(200);
      expect(await next.json()).toEqual({ rooms: [] });
    });
  });

  it("answers invalid_booking for the time 2026-13-45T99:99:99Z and still lists bookings", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", json(ROOM));
      const bad = await call("POST", "/rooms/r1/bookings", json({ ...BOOKING, start: "2026-13-45T99:99:99Z" }));
      await expectError(bad, 400, "invalid_booking");
      const next = await call("GET", "/rooms/r1/bookings");
      expect(next.status).toBe(200);
      expect(await next.json()).toEqual({ bookings: [] });
    });
  });

  it("answers invalid_room for the oversized capacity 1e400 and still lists rooms", async () => {
    await withServer(async (call) => {
      await expectError(await call("POST", "/rooms", '{"name": "Aurora", "capacity": 1e400}'), 400, "invalid_room");
      const next = await call("GET", "/rooms");
      expect(next.status).toBe(200);
      expect(await next.json()).toEqual({ rooms: [] });
    });
  });

  it("answers 201 with id r1 for a valid room after an empty body was rejected", async () => {
    await withServer(async (call) => {
      await expectError(await call("POST", "/rooms", ""), 400, "invalid_json");
      const next = await call("POST", "/rooms", json(ROOM));
      expect(next.status).toBe(201);
      expect(await next.json()).toMatchObject({ id: "r1", name: "Aurora", capacity: 10 });
    });
  });
});
