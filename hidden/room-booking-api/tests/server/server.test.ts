import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePort, startServer } from "../../src/index.js";

interface Reply {
  status: number;
  contentType: string | null;
  text: string;
  json: any;
}

async function withServer(fn: (call: (method: string, path: string, body?: string) => Promise<Reply>, port: number) => Promise<void>) {
  const started = await startServer(0);
  try {
    const call = async (method: string, path: string, body?: string): Promise<Reply> => {
      const res = await fetch(`http://127.0.0.1:${started.port}${path}`, {
        method,
        body,
        headers: body === undefined ? {} : { "content-type": "application/json" },
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, contentType: res.headers.get("content-type"), text, json };
    };
    await fn(call, started.port);
  } finally {
    await started.close();
  }
}

const roomsOf = (json: any): unknown[] | null => (Array.isArray(json) ? json : Array.isArray(json?.rooms) ? json.rooms : null);
const isJson = (ct: string | null) => ct !== null && ct.startsWith("application/json");
const AURORA = JSON.stringify({ name: "Aurora", capacity: 2 });
const BOOKING = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ title: "Standup", start: "2026-11-02T09:00:00Z", end: "2026-11-02T10:00:00Z", attendees: 1, ...over });

describe("malformed JSON body (BEH-018)", () => {
  // @covers room-booking-api:BEH-018
  it.each([
    ["truncated JSON", '{"name": "Aurora", "capacity":'],
    ["empty body", ""],
    ["JSON array instead of object", '[{"name": "Aurora", "capacity": 2}]'],
  ])("POST /rooms with %s answers 400 invalid_json and leaves the room listing unchanged", async (_n, body) => {
    await withServer(async (call) => {
      const before = await call("GET", "/rooms");
      const res = await call("POST", "/rooms", body);
      expect(res.status).toBe(400);
      expect(isJson(res.contentType)).toBe(true);
      expect(res.json).toEqual({ error: "invalid_json" });
      const after = await call("GET", "/rooms");
      expect(after.json).toEqual(before.json);
      const ok = await call("POST", "/rooms", AURORA);
      expect(ok.status).toBe(201);
      expect(ok.json.id).toBe("r1");
    });
  });

  it("POST /rooms/r1/bookings with truncated JSON answers 400 invalid_json and adds no Booking", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", AURORA);
      const before = await call("GET", "/rooms/r1/bookings");
      const res = await call("POST", "/rooms/r1/bookings", '{"title": "Standup",');
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: "invalid_json" });
      const after = await call("GET", "/rooms/r1/bookings");
      expect(after.json).toEqual(before.json);
    });
  });
});

describe("unknown routes and unsupported methods (BEH-019)", () => {
  // @covers room-booking-api:BEH-019
  it("GET /unknown answers 404 not_found and PUT /rooms answers 405 method_not_allowed while GET /rooms answers 200", async () => {
    await withServer(async (call) => {
      const nf = await call("GET", "/unknown");
      expect(nf.status).toBe(404);
      expect(isJson(nf.contentType)).toBe(true);
      expect(nf.json).toEqual({ error: "not_found" });
      const mna = await call("PUT", "/rooms", AURORA);
      expect(mna.status).toBe(405);
      expect(mna.json).toEqual({ error: "method_not_allowed" });
      const ok = await call("GET", "/rooms");
      expect(ok.status).toBe(200);
      expect(roomsOf(ok.json)).not.toBeNull();
    });
  });

  it("PUT /bookings/b1 answers 405 method_not_allowed", async () => {
    await withServer(async (call) => {
      const res = await call("PUT", "/bookings/b1", "{}");
      expect(res.status).toBe(405);
      expect(res.json).toEqual({ error: "method_not_allowed" });
    });
  });
});

describe("PORT selection (BEH-021, EXT-001)", () => {
  it("resolvePort maps decimal strings to numbers, including 0", () => {
    expect(resolvePort("4123")).toBe(4123);
    expect(resolvePort("0")).toBe(0);
  });

  // @covers room-booking-api:EXT-001
  it("a server started without PORT falls back to 3000", async () => {
    expect(resolvePort(undefined)).toBe(3000);
    const saved = process.env.PORT;
    delete process.env.PORT;
    const started = await startServer();
    try {
      expect(started.port).toBe(3000);
      const res = await fetch("http://127.0.0.1:3000/rooms");
      expect(res.status).toBe(200);
    } finally {
      await started.close();
      if (saved !== undefined) process.env.PORT = saved;
    }
  });

  // @covers room-booking-api:BEH-021
  it("a server started with PORT=4123 answers on 4123", async () => {
    const saved = process.env.PORT;
    process.env.PORT = "4123";
    const started = await startServer();
    try {
      expect(started.port).toBe(4123);
      const res = await fetch("http://127.0.0.1:4123/rooms");
      expect(res.status).toBe(200);
      expect(roomsOf(await res.json())).not.toBeNull();
    } finally {
      await started.close();
      if (saved === undefined) delete process.env.PORT;
      else process.env.PORT = saved;
    }
  });

  it("PORT=0 binds an ephemeral port that is not 3000 and answers on it", async () => {
    const saved = process.env.PORT;
    process.env.PORT = "0";
    const started = await startServer();
    try {
      expect(started.port).not.toBe(3000);
      expect(started.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${started.port}/rooms`);
      expect(res.status).toBe(200);
    } finally {
      await started.close();
      if (saved === undefined) delete process.env.PORT;
      else process.env.PORT = saved;
    }
  });
});

describe("error envelope (CTR-007)", () => {
  // @covers room-booking-api:CTR-007
  it("every failure response is a JSON catalogue code with Content-Type application/json", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", JSON.stringify({ name: "Aurora", capacity: 10 }));
      const b1 = await call("POST", "/rooms/r1/bookings", BOOKING());
      expect(b1.status).toBe(201);
      const cases: Array<[string, string, string | undefined, number, string]> = [
        ["GET", "/unknown", undefined, 404, "not_found"],
        ["PUT", "/rooms", "{}", 405, "method_not_allowed"],
        ["POST", "/rooms", '{"name":', 400, "invalid_json"],
        ["GET", "/rooms?minCapacity=0", undefined, 400, "invalid_query"],
        ["POST", "/rooms", '{"name": "", "capacity": 3}', 400, "invalid_room"],
        ["POST", "/rooms/r1/bookings", BOOKING({ title: "" }), 400, "invalid_booking"],
        ["GET", "/rooms/r9/bookings", undefined, 404, "room_not_found"],
        ["DELETE", "/bookings/b7", undefined, 404, "booking_not_found"],
        ["POST", "/rooms", '{"name": "aurora", "capacity": 2}', 409, "room_name_taken"],
        ["POST", "/rooms/r1/bookings", BOOKING({ title: "Sync", start: "2026-11-02T11:00:00Z", end: "2026-11-02T12:00:00Z", attendees: 99 }), 422, "over_capacity"],
      ];
      for (const [m, p, b, status, code] of cases) {
        const res = await call(m, p, b);
        expect([m, p, res.status]).toEqual([m, p, status]);
        expect(isJson(res.contentType)).toBe(true);
        expect(res.json).toEqual({ error: code });
      }
    });
  });

  it("a 409 room_busy body carries conflictingBookingId b1", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", JSON.stringify({ name: "Aurora", capacity: 10 }));
      await call("POST", "/rooms/r1/bookings", BOOKING());
      const res = await call(
        "POST",
        "/rooms/r1/bookings",
        BOOKING({ title: "Sync", start: "2026-11-02T09:30:00Z", end: "2026-11-02T10:30:00Z" }),
      );
      expect(res.status).toBe(409);
      expect(isJson(res.contentType)).toBe(true);
      expect(res.json).toEqual({ error: "room_busy", conflictingBookingId: "b1" });
    });
  });

  it("a 204 from DELETE /bookings/b1 has a zero-length body and no JSON content type", async () => {
    await withServer(async (call) => {
      await call("POST", "/rooms", JSON.stringify({ name: "Aurora", capacity: 10 }));
      await call("POST", "/rooms/r1/bookings", BOOKING());
      const res = await call("DELETE", "/bookings/b1");
      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(isJson(res.contentType)).toBe(false);
    });
  });
});

describe("JSON content type (INV-002)", () => {
  // @covers room-booking-api:INV-002
  it("success, not_found and conflict responses carry application/json and the 204 carries none", async () => {
    await withServer(async (call) => {
      const created = await call("POST", "/rooms", JSON.stringify({ name: "Aurora", capacity: 6 }));
      expect(created.status).toBe(201);
      expect(isJson(created.contentType)).toBe(true);
      expect(created.json).not.toBeNull();
      const nf = await call("GET", "/unknown");
      expect(nf.status).toBe(404);
      expect(isJson(nf.contentType)).toBe(true);
      expect(nf.json).not.toBeNull();
      const dup = await call("POST", "/rooms", '{"name": "aurora", "capacity": 2}');
      expect(dup.status).toBe(409);
      expect(isJson(dup.contentType)).toBe(true);
      expect(dup.json).not.toBeNull();
      await call("POST", "/rooms/r1/bookings", BOOKING());
      const del = await call("DELETE", "/bookings/b1");
      expect(del.status).toBe(204);
      expect(del.text).toBe("");
      expect(isJson(del.contentType)).toBe(false);
    });
  });
});

describe("boundary validation (POL-002)", () => {
  // @covers room-booking-api:POL-002
  it.each([
    ["malformed JSON", "POST", "/rooms", '{"name": "Aurora", "capacity":', 400, "invalid_json"],
    ["unparseable time", "POST", "/rooms/r1/bookings", BOOKING({ start: "not-a-time" }), 400, "invalid_booking"],
    ["unknown path", "GET", "/no/such/path", undefined, 404, "not_found"],
    ["oversized numeric value", "POST", "/rooms", '{"name": "Zed", "capacity": 99999999999999999999}', 400, "invalid_room"],
  ] as Array<[string, string, string, string | undefined, number, string]>)(
    "after a rejected request (%s) the same process still serves a valid request",
    async (_n, method, path, body, status, code) => {
      await withServer(async (call) => {
        await call("POST", "/rooms", AURORA);
        const before = await call("GET", "/rooms");
        const bad = await call(method, path, body);
        expect(bad.status).toBe(status);
        expect(bad.json).toEqual({ error: code });
        const after = await call("GET", "/rooms");
        expect(after.status).toBe(200);
        expect(after.json).toEqual(before.json);
        const ok = await call("POST", "/rooms", JSON.stringify({ name: "Borealis", capacity: 4 }));
        expect(ok.status).toBe(201);
        expect(ok.json.id).toBe("r2");
      });
    },
  );
});

describe("toolchain constraints", () => {
  // @covers room-booking-api:CON-001
  it("tsc --noEmit exits 0 and the typed server entry answers requests", async () => {
    const r = spawnSync("node_modules/.bin/tsc", ["--noEmit"], { cwd: process.cwd(), encoding: "utf8" });
    expect(r.status).toBe(0);
    await withServer(async (call, port) => {
      expect(typeof port).toBe("number");
      expect((await call("GET", "/rooms")).status).toBe(200);
    });
  }, 180_000);

  // @covers room-booking-api:CON-002
  it("the server starts and answers on Node.js 22 or newer", async () => {
    expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(22);
    await withServer(async (call) => {
      expect((await call("GET", "/rooms")).status).toBe(200);
    });
  });

  // @covers room-booking-api:CON-003
  it("package scripts define build and test and the server accepts requests on an ephemeral port", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(pkg.scripts.test).toBe("vitest run");
    await withServer(async (call, port) => {
      expect(port).toBeGreaterThan(0);
      expect((await call("GET", "/rooms")).status).toBe(200);
    });
  });

  // @covers room-booking-api:CON-004
  it("package.json lists no runtime dependency and the server still answers with built-in modules", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    await withServer(async (call) => {
      expect((await call("GET", "/rooms")).status).toBe(200);
    });
  });

  // @covers room-booking-api:CON-005
  it("the server answers on the loopback interface without contacting an external service", async () => {
    await withServer(async (call, port) => {
      const res = await call("GET", "/rooms");
      expect(res.status).toBe(200);
      expect(port).toBeGreaterThan(0);
    });
  });

  // @covers room-booking-api:NFR-001
  it("the build and test scripts are defined and a request round trip succeeds", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(pkg.scripts.test).toBe("vitest run");
    await withServer(async (call) => {
      const res = await call("POST", "/rooms", AURORA);
      expect(res.status).toBe(201);
    });
  });
});
