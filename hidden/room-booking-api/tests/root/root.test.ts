import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boot, freePort, run, send, startBuilt } from "./helpers.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const AURORA = '{"name":"Aurora","capacity":8}';
const BOOKING = '{"title":"Standup","start":"2026-11-02T09:00:00Z","end":"2026-11-02T09:30:00Z","attendees":5}';

describe("root: body syntax", () => {
  // @covers room-booking-api:BEH-021
  it("answers 400 invalid_json to an empty, truncated or trailing-garbage body and creates no room", async () => {
    const app = await boot();
    try {
      for (const body of ["", '{"name":"Aurora",', '{"name":"Aurora","capacity":8}x']) {
        const r = await send(app.port, "POST", "/rooms", body);
        expect(r.status).toBe(400);
        expect(r.json).toEqual({ error: "invalid_json" });
      }
      const list = await send(app.port, "GET", "/rooms");
      expect(list.status).toBe(200);
      expect(list.json).toEqual({ rooms: [] });
    } finally {
      await app.close();
    }
  });

  it("answers 400 invalid_json to an empty body on POST /rooms/r1/bookings", async () => {
    const app = await boot();
    try {
      const made = await send(app.port, "POST", "/rooms", AURORA);
      expect(made.status).toBe(201);
      const r = await send(app.port, "POST", "/rooms/r1/bookings", "");
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: "invalid_json" });
    } finally {
      await app.close();
    }
  });

  it("answers 400 invalid_room to the body null and 201 to a valid room body", async () => {
    const app = await boot();
    try {
      const n = await send(app.port, "POST", "/rooms", "null");
      expect(n.status).toBe(400);
      expect(n.json).toEqual({ error: "invalid_room" });
      const ok = await send(app.port, "POST", "/rooms", AURORA);
      expect(ok.status).toBe(201);
      expect(ok.json).toEqual({ id: "r1", name: "Aurora", capacity: 8 });
    } finally {
      await app.close();
    }
  });

  // @covers room-booking-api:BEH-025
  it("ignores the request Content-Type and the presence of a valid JSON body on GET", async () => {
    const app = await boot();
    try {
      const a = await send(app.port, "POST", "/rooms", AURORA);
      expect(a.status).toBe(201);
      expect(a.json).toEqual({ id: "r1", name: "Aurora", capacity: 8 });
      const b = await send(app.port, "POST", "/rooms", '{"name":"Borealis","capacity":4}', { "Content-Type": "text/plain" });
      expect(b.status).toBe(201);
      expect(b.json).toEqual({ id: "r2", name: "Borealis", capacity: 4 });
      const noBody = await send(app.port, "GET", "/rooms");
      expect(noBody.status).toBe(200);
      expect(noBody.json.rooms).toHaveLength(2);
      const withJson = await send(app.port, "GET", "/rooms", '{"hello":1}');
      expect(withJson.status).toBe(200);
      expect(withJson.json.rooms).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("answers 400 invalid_json to a malformed body on GET, DELETE and POST without a JSON Content-Type", async () => {
    const app = await boot();
    try {
      const g = await send(app.port, "GET", "/rooms", '{"hello":');
      expect(g.status).toBe(400);
      expect(g.json).toEqual({ error: "invalid_json" });
      const d = await send(app.port, "DELETE", "/bookings/b1", '{"x":');
      expect(d.status).toBe(400);
      expect(d.json).toEqual({ error: "invalid_json" });
      const t = await send(app.port, "POST", "/rooms", '{"name":', { "Content-Type": "text/plain" });
      expect(t.status).toBe(400);
      expect(t.json).toEqual({ error: "invalid_json" });
      const n = await send(app.port, "POST", "/rooms", '{"name":"Aurora",');
      expect(n.status).toBe(400);
      expect(n.json).toEqual({ error: "invalid_json" });
      const none = await send(app.port, "DELETE", "/bookings/b99");
      expect(none.status).toBe(404);
      expect(none.json).toEqual({ error: "booking_not_found" });
    } finally {
      await app.close();
    }
  });

  // @covers room-booking-api:INV-006
  it("decides route, then method, then body syntax, then endpoint rules", async () => {
    const app = await boot();
    try {
      const route = await send(app.port, "PUT", "/nope", '{"x":');
      expect(route.status).toBe(404);
      expect(route.json).toEqual({ error: "not_found" });
      const method = await send(app.port, "DELETE", "/rooms", '{"x":');
      expect(method.status).toBe(405);
      expect(method.json).toEqual({ error: "method_not_allowed" });
      const q = "/availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=two";
      const body = await send(app.port, "GET", q, '{"x":');
      expect(body.status).toBe(400);
      expect(body.json).toEqual({ error: "invalid_json" });
      const rule = await send(app.port, "GET", q);
      expect(rule.status).toBe(400);
      expect(rule.json).toEqual({ error: "invalid_query" });
      const absent = await send(app.port, "DELETE", "/bookings/b99");
      expect(absent.status).toBe(404);
      expect(absent.json).toEqual({ error: "booking_not_found" });
    } finally {
      await app.close();
    }
  });

  it("returns the higher-priority endpoint code when a request breaks two endpoint rules", async () => {
    const app = await boot();
    try {
      await send(app.port, "POST", "/rooms", AURORA);
      const longName = "A".repeat(41);
      const room = await send(app.port, "POST", "/rooms", JSON.stringify({ name: longName, capacity: 8 }));
      expect(room.status).toBe(400);
      expect(room.json).toEqual({ error: "invalid_room" });
      const nf = await send(
        app.port,
        "POST",
        "/rooms/r99/bookings",
        '{"title":"","start":"2026-11-02T09:00:00Z","end":"2026-11-02T09:30:00Z","attendees":5}',
      );
      expect(nf.status).toBe(404);
      expect(nf.json).toEqual({ error: "room_not_found" });
      const zero = await send(
        app.port,
        "POST",
        "/rooms/r1/bookings",
        '{"title":"Standup","start":"2026-11-02T09:00:00Z","end":"2026-11-02T09:30:00Z","attendees":0}',
      );
      expect(zero.status).toBe(400);
      expect(zero.json).toEqual({ error: "invalid_booking" });
    } finally {
      await app.close();
    }
  });

  // @covers room-booking-api:POL-002
  it("keeps serving after every invalid request class", async () => {
    const app = await boot();
    try {
      const a = await send(app.port, "POST", "/rooms", '{"name":');
      expect([a.status, a.json]).toEqual([400, { error: "invalid_json" }]);
      const b = await send(app.port, "POST", "/rooms", AURORA);
      expect(b.status).toBe(201);
      expect(b.json).toEqual({ id: "r1", name: "Aurora", capacity: 8 });
      const c = await send(app.port, "POST", "/rooms", "");
      expect([c.status, c.json]).toEqual([400, { error: "invalid_json" }]);
      const d = await send(app.port, "GET", "/rooms?minCapacity=abc");
      expect([d.status, d.json]).toEqual([400, { error: "invalid_query" }]);
      const e = await send(app.port, "GET", "/rooms?minCapacity=8");
      expect(e.status).toBe(200);
      expect(e.json.rooms).toHaveLength(1);
      const f = await send(app.port, "POST", "/rooms", '{"name":"Borealis"}');
      expect([f.status, f.json]).toEqual([400, { error: "invalid_room" }]);
      const g = await send(app.port, "GET", "/nope");
      expect([g.status, g.json]).toEqual([404, { error: "not_found" }]);
      const h = await send(app.port, "GET", "/rooms");
      expect(h.status).toBe(200);
      expect(h.json.rooms).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("writes JSON bodies with Content-Type application/json and the 204 with neither body nor Content-Type", async () => {
    const app = await boot();
    try {
      const ok = await send(app.port, "POST", "/rooms", AURORA);
      expect(ok.contentType).toContain("application/json");
      const err = await send(app.port, "GET", "/nope");
      expect(err.contentType).toContain("application/json");
      const made = await send(app.port, "POST", "/rooms/r1/bookings", BOOKING);
      expect(made.status).toBe(201);
      const del = await send(app.port, "DELETE", `/bookings/${made.json.id}`);
      expect(del.status).toBe(204);
      expect(del.raw).toBe("");
      expect(del.contentType).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe("root: process and constraints", () => {
  // @covers room-booking-api:CON-001
  it("serves a full request sequence with the listening port as its only network activity", async () => {
    const app = await boot();
    try {
      const a = await send(app.port, "POST", "/rooms", AURORA);
      expect(a.status).toBe(201);
      const b = await send(app.port, "POST", "/rooms/r1/bookings", BOOKING);
      expect(b.status).toBe(201);
      const c = await send(app.port, "GET", "/rooms/r1/bookings");
      expect(c.status).toBe(200);
      const d = await send(app.port, "GET", "/rooms");
      expect(d.json).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 8 }] });
    } finally {
      await app.close();
    }
  });

  // @covers room-booking-api:CON-002
  it("declares no runtime dependency and the built-in server answers", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    const app = await boot();
    try {
      const r = await send(app.port, "GET", "/rooms");
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ rooms: [] });
    } finally {
      await app.close();
    }
  });

  // @covers room-booking-api:CON-003
  it("answers HTTP on PORT after npm run build and npm start", { timeout: 120000 }, async () => {
    const build = await run("npm", ["run", "build"]);
    expect(build.code).toBe(0);
    const port = await freePort();
    const started = await startBuilt({ ...process.env, PORT: String(port) }, port);
    try {
      expect(started.answered?.status).toBe(200);
      expect(started.answered?.json).toEqual({ rooms: [] });
    } finally {
      started.stop();
    }
  });

  it("answers HTTP on 3000 when PORT is unset", { timeout: 120000 }, async () => {
    const build = await run("npm", ["run", "build"]);
    expect(build.code).toBe(0);
    const env = { ...process.env };
    delete env.PORT;
    const started = await startBuilt(env, 3000);
    try {
      expect(started.answered?.status).toBe(200);
    } finally {
      started.stop();
    }
  });

  it("binds an actual ephemeral port when PORT is 0", async () => {
    const saved = process.env.PORT;
    process.env.PORT = "0";
    let server: Server | undefined;
    try {
      const { vi } = await import("vitest");
      vi.resetModules();
      const mod = await import("../../src/index.js");
      server = await mod.startServer();
      const port = (server.address() as AddressInfo).port;
      expect(port).toBeGreaterThan(0);
      const r = await send(port, "GET", "/rooms");
      expect(r.status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.PORT;
      else process.env.PORT = saved;
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((res) => server!.close(() => res()));
      }
    }
  });

  // @covers room-booking-api:NFR-001
  it("exits 0 on two consecutive npm run build runs and defines the start script", { timeout: 120000 }, async () => {
    const first = await run("npm", ["run", "build"]);
    expect(first.code).toBe(0);
    expect(first.out).not.toContain("error TS");
    const second = await run("npm", ["run", "build"]);
    expect(second.code).toBe(0);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.start).toBe("node dist/index.js");
  });

  // @covers room-booking-api:NFR-002
  it("serves from a server started on an ephemeral port while the suite runs", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.test).toBe("vitest run");
    const app = await boot();
    try {
      const r = await send(app.port, "GET", "/rooms");
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ rooms: [] });
    } finally {
      await app.close();
    }
  });
});
