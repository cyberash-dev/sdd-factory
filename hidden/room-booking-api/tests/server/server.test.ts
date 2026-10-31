import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { startServer } from "../../src/server/index.js";

interface Reply {
  status: number;
  text: string;
  contentType: string | null;
  json: unknown;
}

async function send(
  base: string,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<Reply> {
  const res = await fetch(base + path, { method, body, headers });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, contentType: res.headers.get("content-type"), json };
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const VALID_BOOKING = JSON.stringify({
  title: "Sync",
  start: "2026-11-02T10:00:00Z",
  end: "2026-11-02T11:00:00Z",
  attendees: 2,
});

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const running = await startServer(0);
  try {
    await fn(running.url);
  } finally {
    await running.close();
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, () => {
      const address = s.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      s.close(() => resolve(port));
    });
  });
}

describe("server routing", () => {
  // @covers room-booking-api:BEH-020
  it.each([
    ["GET", "/nope", undefined],
    ["GET", "/rooms/r1", undefined],
    ["POST", "/nope", '{"a": 1}'],
    ["PATCH", "/rooms/r1", undefined],
    ["GET", "/rooms/", undefined],
    ["GET", "/rooms/r1/bookings/b1", undefined],
    ["GET", "/", undefined],
  ])("answers not_found 404 for the undeclared path %s %s", async (method, path, body) => {
    await withServer(async (base) => {
      const r = await send(base, method, path, body, body ? JSON_HEADERS : undefined);
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: "not_found" });
    });
  });

  it("answers invalid_json 400 for an invalid JSON body on an undeclared path, never not_found", async () => {
    await withServer(async (base) => {
      const r = await send(base, "POST", "/nope", "{", JSON_HEADERS);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: "invalid_json" });
    });
  });

  it("answers 200 with a bookings array for the declared route GET /rooms/r1/bookings and 405 for PUT /rooms", async () => {
    await withServer(async (base) => {
      const created = await send(base, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      expect(created.status).toBe(201);
      const list = await send(base, "GET", "/rooms/r1/bookings");
      expect(list.status).toBe(200);
      expect(list.json).toEqual({ bookings: [] });
      const put = await send(base, "PUT", "/rooms");
      expect(put.status).toBe(405);
      expect(put.json).toEqual({ error: "method_not_allowed" });
    });
  });

  // @covers room-booking-api:BEH-021
  it.each([
    ["PUT", "/rooms"],
    ["DELETE", "/rooms"],
    ["GET", "/bookings/b1"],
    ["POST", "/availability"],
    ["PUT", "/availability"],
    ["PUT", "/rooms/r1/bookings"],
    ["DELETE", "/rooms/r1/bookings"],
    ["POST", "/bookings/b1"],
  ])("answers method_not_allowed 405 for %s on the declared path %s", async (method, path) => {
    await withServer(async (base) => {
      const r = await send(base, method, path);
      expect(r.status).toBe(405);
      expect(r.json).toEqual({ error: "method_not_allowed" });
    });
  });

  it("answers a status other than 405 for the declared method POST /rooms and 404 not_found for GET /nope", async () => {
    await withServer(async (base) => {
      const ok = await send(base, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      expect(ok.status).toBe(201);
      expect(ok.json).toEqual({ id: "r1", name: "Lab", capacity: 10 });
      const nope = await send(base, "GET", "/nope");
      expect(nope.status).toBe(404);
      expect(nope.json).toEqual({ error: "not_found" });
    });
  });

  it("answers invalid_json 400 for an invalid JSON body on a declared path with an undeclared method", async () => {
    await withServer(async (base) => {
      const r = await send(base, "PUT", "/rooms", "{", JSON_HEADERS);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: "invalid_json" });
    });
  });

  // @covers room-booking-api:CTR-007
  it("resolves invalid_json, then not_found, then method_not_allowed, with a JSON content type", async () => {
    await withServer(async (base) => {
      const empty = await send(base, "POST", "/nope", "");
      expect(empty.status).toBe(404);
      expect(empty.json).toEqual({ error: "not_found" });
      expect(empty.contentType).toBe("application/json");

      const both = await send(base, "PATCH", "/rooms/r1");
      expect(both.status).toBe(404);
      expect(both.json).toEqual({ error: "not_found" });

      const unsupported = await send(base, "PUT", "/rooms");
      expect(unsupported.status).toBe(405);
      expect(unsupported.json).toEqual({ error: "method_not_allowed" });
      expect(unsupported.contentType).toBe("application/json");

      const declared = await send(base, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      expect(declared.status).toBe(201);

      const badJson = await send(base, "PATCH", "/nope", "{", JSON_HEADERS);
      expect(badJson.status).toBe(400);
      expect(badJson.json).toEqual({ error: "invalid_json" });
      expect(badJson.contentType).toBe("application/json");
    });
  });
});

describe("server boundary validation", () => {
  // @covers room-booking-api:POL-002
  it.each([
    ["invalid JSON", "POST", "/rooms", "{", 400, { error: "invalid_json" }],
    [
      "missing query parameter",
      "GET",
      "/availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z",
      undefined,
      400,
      { error: "invalid_query" },
    ],
    ["invalid field value", "POST", "/rooms", '{"name":"Lab","capacity":0}', 400, { error: "invalid_room" }],
    ["unknown id", "DELETE", "/bookings/b7", undefined, 404, { error: "booking_not_found" }],
  ])(
    "answers the documented 4xx for %s, leaves the store unchanged and keeps serving",
    async (_label, method, path, body, status, error) => {
      await withServer(async (base) => {
        await send(base, "POST", "/rooms", '{"name":"Aula","capacity":4}', JSON_HEADERS);
        const roomsBefore = await send(base, "GET", "/rooms");
        const bookingsBefore = await send(base, "GET", "/rooms/r1/bookings");
        const r = await send(base, method, path, body, body ? JSON_HEADERS : undefined);
        expect(r.status).toBe(status);
        expect(r.json).toEqual(error);
        const roomsAfter = await send(base, "GET", "/rooms");
        const bookingsAfter = await send(base, "GET", "/rooms/r1/bookings");
        expect(roomsAfter.status).toBe(200);
        expect(roomsAfter.text).toBe(roomsBefore.text);
        expect(bookingsAfter.text).toBe(bookingsBefore.text);
      });
    },
  );

  it("answers over_capacity 422 and leaves the bookings of the room unchanged", async () => {
    await withServer(async (base) => {
      await send(base, "POST", "/rooms", '{"name":"Aula","capacity":4}', JSON_HEADERS);
      const before = await send(base, "GET", "/rooms/r1/bookings");
      const r = await send(
        base,
        "POST",
        "/rooms/r1/bookings",
        JSON.stringify({ title: "Big", start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z", attendees: 5 }),
        JSON_HEADERS,
      );
      expect(r.status).toBe(422);
      expect(r.json).toEqual({ error: "over_capacity" });
      const after = await send(base, "GET", "/rooms/r1/bookings");
      expect(after.status).toBe(200);
      expect(after.text).toBe(before.text);
    });
  });

  it("serves a valid booking after a rejected request and answers DELETE of it with 204 and no body", async () => {
    await withServer(async (base) => {
      await send(base, "POST", "/rooms", "{", JSON_HEADERS);
      const room = await send(base, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      expect(room.status).toBe(201);
      const booking = await send(base, "POST", "/rooms/r1/bookings", VALID_BOOKING, JSON_HEADERS);
      expect(booking.status).toBe(201);
      const removed = await send(base, "DELETE", "/bookings/b1");
      expect(removed.status).toBe(204);
      expect(removed.text).toBe("");
      expect(removed.contentType).toBeNull();
    });
  });
});

describe("server localisation", () => {
  // @covers room-booking-api:LOC-001
  it("returns error bodies holding only the code and requester-supplied text verbatim", async () => {
    await withServer(async (base) => {
      const german = { "Accept-Language": "de-DE" };
      const err = await send(base, "GET", "/nope", undefined, german);
      expect(err.text).toBe('{"error":"not_found"}');
      const err405 = await send(base, "PUT", "/rooms", undefined, german);
      expect(err405.text).toBe('{"error":"method_not_allowed"}');

      const name = "Zürich Größe 会議室 ☕";
      const room = await send(
        base,
        "POST",
        "/rooms",
        JSON.stringify({ name, capacity: 10 }),
        JSON_HEADERS,
      );
      expect(room.status).toBe(201);
      expect(room.json).toEqual({ id: "r1", name, capacity: 10 });

      const title = "Überprüfung – Besprechung «日本語»";
      const booking = await send(
        base,
        "POST",
        "/rooms/r1/bookings",
        JSON.stringify({ title, start: "2026-11-02T10:00Z", end: "2026-11-02T11:00:00.000Z", attendees: 2 }),
        JSON_HEADERS,
      );
      expect(booking.status).toBe(201);
      expect(booking.json).toEqual({
        id: "b1",
        roomId: "r1",
        title,
        start: "2026-11-02T10:00Z",
        end: "2026-11-02T11:00:00.000Z",
        attendees: 2,
      });
    });
  });
});

describe("server process state", () => {
  // @covers room-booking-api:INV-006
  it("starts a new process with no room and no booking and room ids from r1 again", async () => {
    const first = await startServer(0);
    const port = first.port;
    try {
      await send(first.url, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      await send(first.url, "POST", "/rooms/r1/bookings", VALID_BOOKING, JSON_HEADERS);
    } finally {
      await first.close();
    }
    const second = await startServer(port);
    try {
      const rooms = await send(second.url, "GET", "/rooms");
      expect(rooms.status).toBe(200);
      expect(rooms.json).toEqual({ rooms: [] });
      const bookings = await send(second.url, "GET", "/rooms/r1/bookings");
      expect(bookings.status).toBe(404);
      expect(bookings.json).toEqual({ error: "room_not_found" });
      const again = await send(second.url, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      expect(again.status).toBe(201);
      expect((again.json as { id: string }).id).toBe("r1");
    } finally {
      await second.close();
    }
  });

  it("serves an empty store after a process that held no entity was stopped", async () => {
    const first = await startServer(0);
    const port = first.port;
    await first.close();
    await withServer(async () => {});
    const second = await startServer(port);
    try {
      const rooms = await send(second.url, "GET", "/rooms");
      expect(rooms.json).toEqual({ rooms: [] });
    } finally {
      await second.close();
    }
  });

  // @covers room-booking-api:SCN-003
  it("loses rooms and bookings when the process stops and restarts room ids at r1 on the same port", async () => {
    const first = await startServer(0);
    const port = first.port;
    try {
      const room = await send(first.url, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      expect(room.status).toBe(201);
      const booking = await send(first.url, "POST", "/rooms/r1/bookings", VALID_BOOKING, JSON_HEADERS);
      expect(booking.status).toBe(201);
    } finally {
      await first.close();
    }
    const second = await startServer(port);
    try {
      expect(second.port).toBe(port);
      const rooms = await send(second.url, "GET", "/rooms");
      expect(rooms.status).toBe(200);
      expect(rooms.json).toEqual({ rooms: [] });
      const bookings = await send(second.url, "GET", "/rooms/r1/bookings");
      expect(bookings.status).toBe(404);
      expect(bookings.json).toEqual({ error: "room_not_found" });
      const created = await send(second.url, "POST", "/rooms", '{"name":"Lab","capacity":10}', JSON_HEADERS);
      expect(created.status).toBe(201);
      expect(created.json).toEqual({ id: "r1", name: "Lab", capacity: 10 });
    } finally {
      await second.close();
    }
  });
});

describe("server constraints", () => {
  // @covers room-booking-api:CON-001
  it("serves every request from process-local memory on an OS-assigned port with a fresh empty store", async () => {
    const running = await startServer(0);
    try {
      expect(running.port).toBeGreaterThan(0);
      const rooms = await send(running.url, "GET", "/rooms");
      expect(rooms.status).toBe(200);
      expect(rooms.json).toEqual({ rooms: [] });
      const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
      expect(manifest.dependencies).toBeUndefined();
    } finally {
      await running.close();
    }
  });

  // @covers room-booking-api:CON-002
  it("declares no runtime dependency and starts through the start script node dist/index.js", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(manifest.scripts?.start).toBe("node dist/index.js");
  });

  // @covers room-booking-api:NFR-001
  it("exits 0 for npm run build and then npm start serves requests on PORT", async () => {
    const build = spawnSync("npm", ["run", "build"], { cwd: process.cwd(), encoding: "utf8" });
    expect(build.status).toBe(0);

    const port = await freePort();
    const child = spawn("npm", ["start"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
      detached: true,
    });
    try {
      let answered: Reply | null = null;
      for (let i = 0; i < 100 && answered === null; i++) {
        try {
          answered = await send(`http://127.0.0.1:${port}`, "GET", "/rooms");
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      expect(answered).not.toBeNull();
      expect(answered?.status).toBe(200);
      expect(answered?.json).toEqual({ rooms: [] });
    } finally {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }
  }, 120000);
});
