import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolvePort, startServer } from "../../src/index.js";

const run = promisify(execFile);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function pollRooms(port: number): Promise<Response> {
  const deadline = Date.now() + 30000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}/rooms`);
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`no answer on port ${port}: ${String(lastError)}`);
}

async function withStartedProcess(
  env: NodeJS.ProcessEnv,
  port: number,
  check: (response: Response) => Promise<void>,
): Promise<void> {
  await run("npm", ["run", "build"], { cwd: process.cwd() });
  const child = spawn("npm", ["start"], { cwd: process.cwd(), env, detached: true, stdio: "ignore" });
  try {
    await check(await pollRooms(port));
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
}

async function json(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

describe("server process configuration", () => {
  it.each([
    [{ PORT: "8080" }, 8080],
    [{ PORT: "65535" }, 65535],
    [{}, 3000],
    [{ PORT: "" }, 3000],
    [{ PORT: "abc" }, 3000],
    [{ PORT: "65536" }, 3000],
  ])("resolvePort(%j) is %i", (env, expected) => {
    expect(resolvePort(env)).toBe(expected);
  });

  it("startServer binds the requested ephemeral port and the state starts empty", async () => {
    const server = await startServer(0);
    try {
      expect(server.port).toBeGreaterThan(0);
      const res = await json(server.port, "GET", "/rooms");
      expect(res).toEqual({ status: 200, body: { rooms: [] } });
    } finally {
      await server.close();
    }
  });

  // @covers room-booking-api:CTR-011
  it("a built process with PORT set answers GET /rooms on that port", async () => {
    const port = await freePort();
    await withStartedProcess({ ...process.env, PORT: String(port) }, port, async (response) => {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ rooms: [] });
    });
  }, 120000);

  it("a built process with PORT unset answers GET /rooms on port 3000", async () => {
    const env = { ...process.env };
    delete env.PORT;
    await withStartedProcess(env, 3000, async (response) => {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ rooms: [] });
    });
  }, 120000);
});

describe("state and network constraints", () => {
  // @covers room-booking-api:INV-004
  it("a restarted process exposes an empty state", async () => {
    const first = await startServer(0);
    try {
      expect((await json(first.port, "POST", "/rooms", { name: "Focus", capacity: 6 })).status).toBe(201);
      expect((await json(first.port, "POST", "/rooms", { name: "Huddle", capacity: 4 })).status).toBe(201);
      const booking = await json(first.port, "POST", "/rooms/r1/bookings", {
        title: "Standup",
        start: "2026-11-02T09:30:00Z",
        end: "2026-11-02T10:00:00Z",
        attendees: 4,
      });
      expect(booking.status).toBe(201);
    } finally {
      await first.close();
    }
    const second = await startServer(0);
    try {
      expect(await json(second.port, "GET", "/rooms")).toEqual({ status: 200, body: { rooms: [] } });
      expect(await json(second.port, "GET", "/rooms/r1/bookings")).toEqual({
        status: 404,
        body: { error: "room_not_found" },
      });
      const created = await json(second.port, "POST", "/rooms", { name: "Focus", capacity: 6 });
      expect(created.status).toBe(201);
      expect((created.body as { id: string }).id).toBe("r1");
    } finally {
      await second.close();
    }
  });

  // @covers room-booking-api:CON-001
  it("the room routes and the availability route answer from the in-memory state alone", async () => {
    const server = await startServer(0);
    try {
      expect((await json(server.port, "POST", "/rooms", { name: "Focus", capacity: 6 })).status).toBe(201);
      expect((await json(server.port, "GET", "/rooms")).status).toBe(200);
      const availability = await fetch(
        `http://127.0.0.1:${server.port}/availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4`,
      );
      expect(availability.status).toBe(200);
      expect(await availability.text()).toContain("Focus");
    } finally {
      await server.close();
    }
  });

  // @covers room-booking-api:CON-002
  it("the product declares no runtime dependency and the server answers", async () => {
    const server = await startServer(0);
    try {
      expect((await json(server.port, "GET", "/rooms")).status).toBe(200);
    } finally {
      await server.close();
    }
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  // @covers room-booking-api:CON-003
  it("the sources are TypeScript and npm start serves after npm run build", async () => {
    const sources = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.[cm]?[jt]s$/.test(f));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((f) => !f.endsWith(".ts"))).toEqual([]);
    const port = await freePort();
    await withStartedProcess({ ...process.env, PORT: String(port) }, port, async (response) => {
      expect(response.status).toBe(200);
      expect(existsSync("dist")).toBe(true);
    });
  }, 120000);
});
