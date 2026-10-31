import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ROOM = JSON.stringify({ name: "Aurora", capacity: 4 });
const BOOKING = JSON.stringify({
  title: "Standup",
  start: "2026-01-05T09:00:00Z",
  end: "2026-01-05T10:00:00Z",
  attendees: 2,
});

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function build(): Promise<void> {
  const out = await run("npm", ["run", "build"]);
  expect(out.code, out.stdout + out.stderr).toBe(0);
  expect(existsSync(join(root, "dist", "index.js"))).toBe(true);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on("error", reject);
    probe.listen(0, () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

async function answers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/rooms`);
    return true;
  } catch {
    return false;
  }
}

interface Started {
  stop: () => Promise<void>;
}

function envWith(port: number | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PORT;
  if (port !== undefined) env.PORT = String(port);
  return env;
}

async function startNpm(port: number | undefined): Promise<Started> {
  const child = spawn("npm", ["start"], { cwd: root, env: envWith(port), detached: true, stdio: "ignore" });
  let exited = false;
  const gone = new Promise<void>((done) => child.on("exit", () => { exited = true; done(); }));
  const stop = async (): Promise<void> => {
    if (!exited) {
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        // group already gone
      }
      await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
    }
    const target = port ?? 3000;
    for (let i = 0; i < 100 && (await answers(target)); i++) await new Promise((r) => setTimeout(r, 50));
  };
  try {
    const target = port ?? 3000;
    for (let i = 0; i < 300; i++) {
      if (exited) throw new Error("npm start exited before the server answered");
      if (await answers(target)) return { stop };
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("npm start did not answer in time");
  } catch (e) {
    await stop();
    throw e;
  }
}

async function send(port: number, method: string, path: string, body?: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, body });
  const text = await res.text();
  return { status: res.status, json: text === "" ? undefined : JSON.parse(text) };
}

async function withProcess(port: number | undefined, fn: (port: number) => Promise<void>): Promise<void> {
  const started = await startNpm(port);
  try {
    await fn(port ?? 3000);
  } finally {
    await started.stop();
  }
}

function readJson(file: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, file), "utf8"));
}

const LOAD_RESOLVE_PORT = (env: string) =>
  `import(${JSON.stringify(pathToFileURL(join(root, "dist", "index.js")).href)}).then((m) => console.log(m.resolvePort(${env})))`;

describe("compiled server process", () => {
  // @covers room-booking-api:CTR-001
  it("npm start listens on 3000 when PORT is unset and on the PORT value when it is set", { timeout: 120000 }, async () => {
    await build();
    const port = await freePort();
    await withProcess(port, async (p) => {
      const res = await send(p, "GET", "/rooms");
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ rooms: [] });
    });
    await withProcess(undefined, async (p) => {
      expect(p).toBe(3000);
      const res = await send(p, "GET", "/rooms");
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ rooms: [] });
    });
  });

  // @covers room-booking-api:CON-006
  it("npm start after npm run build serves the API on the PORT value", { timeout: 120000 }, async () => {
    await build();
    const port = await freePort();
    await withProcess(port, async (p) => {
      const created = await send(p, "POST", "/rooms", ROOM);
      expect(created.status).toBe(201);
      expect(created.json).toEqual({ id: "r1", name: "Aurora", capacity: 4 });
      expect((await send(p, "GET", "/rooms")).json).toEqual({ rooms: [{ id: "r1", name: "Aurora", capacity: 4 }] });
    });
  });

  // @covers room-booking-api:SCN-003
  it("a restarted process lists no room, answers 404 room_not_found for the old room and issues r1 again", { timeout: 120000 }, async () => {
    await build();
    const port = await freePort();
    await withProcess(port, async (p) => {
      expect((await send(p, "POST", "/rooms", ROOM)).status).toBe(201);
      const booked = await send(p, "POST", "/rooms/r1/bookings", BOOKING);
      expect(booked.status).toBe(201);
      expect((booked.json as { id: string }).id).toBe("b1");
    });
    await withProcess(port, async (p) => {
      const rooms = await send(p, "GET", "/rooms");
      expect(rooms.status).toBe(200);
      expect(rooms.json).toEqual({ rooms: [] });
      const old = await send(p, "GET", "/rooms/r1/bookings");
      expect(old.status).toBe(404);
      expect(old.json).toEqual({ error: "room_not_found" });
      const fresh = await send(p, "POST", "/rooms", ROOM);
      expect(fresh.status).toBe(201);
      expect(fresh.json).toEqual({ id: "r1", name: "Aurora", capacity: 4 });
    });
  });

  // @covers room-booking-api:INV-005
  it("a restarted process exposes no room created before the restart when only rooms existed", { timeout: 120000 }, async () => {
    await build();
    const port = await freePort();
    await withProcess(port, async (p) => {
      expect((await send(p, "POST", "/rooms", ROOM)).status).toBe(201);
      expect((await send(p, "POST", "/rooms", '{"name":"Borealis","capacity":6}')).status).toBe(201);
    });
    await withProcess(port, async (p) => {
      const rooms = await send(p, "GET", "/rooms");
      expect(rooms.status).toBe(200);
      expect(rooms.json).toEqual({ rooms: [] });
    });
  });

  // @covers room-booking-api:CON-004
  it("state lives in process memory alone so a restart after rooms and bookings serves an empty list and then documented statuses", { timeout: 120000 }, async () => {
    await build();
    const port = await freePort();
    await withProcess(port, async (p) => {
      expect((await send(p, "POST", "/rooms", ROOM)).status).toBe(201);
      expect((await send(p, "POST", "/rooms/r1/bookings", BOOKING)).status).toBe(201);
    });
    await withProcess(port, async (p) => {
      const rooms = await send(p, "GET", "/rooms");
      expect(rooms.status).toBe(200);
      expect(rooms.json).toEqual({ rooms: [] });
      const next = await send(p, "POST", "/rooms/r1/bookings", BOOKING);
      expect(next.status).toBe(404);
      expect(next.json).toEqual({ error: "room_not_found" });
      const first = await send(p, "POST", "/rooms", ROOM);
      expect(first.status).toBe(201);
      expect((first.json as { id: string }).id).toBe("r1");
    });
  });
});

describe("build and toolchain", () => {
  // @covers room-booking-api:NFR-001
  it("npm run build exits 0 twice in a row and leaves compiled output that loads", { timeout: 120000 }, async () => {
    await build();
    await build();
    const out = await run("node", ["--input-type=module", "-e", LOAD_RESOLVE_PORT("{ PORT: '8080' }")]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe("8080");
  });

  // @covers room-booking-api:CON-001
  it("tsc --noEmit exits 0 on the source tree under strict ESM settings and the build output is ESM", { timeout: 120000 }, async () => {
    const tsc = await run("node", [join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"]);
    expect(tsc.code, tsc.stdout + tsc.stderr).toBe(0);
    expect(readJson("tsconfig.json").compilerOptions.strict).toBe(true);
    expect(readJson("package.json").type).toBe("module");
    await build();
    const out = await run("node", ["--input-type=module", "-e", LOAD_RESOLVE_PORT("{}")]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe("3000");
  });

  // @covers room-booking-api:CON-002
  it("the server runs on Node.js 22 or newer without experimental flags", { timeout: 120000 }, async () => {
    const pkg = readJson("package.json");
    expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(22);
    expect(pkg.engines.node).toBe(">=22");
    expect(pkg.scripts.start).toBe("node dist/index.js");
    expect(process.execArgv.filter((a) => a.includes("experimental"))).toEqual([]);
    await build();
    const out = await run("node", ["--input-type=module", "-e", LOAD_RESOLVE_PORT("{ PORT: '65535' }")]);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe("65535");
  });

  // @covers room-booking-api:CON-003
  it("npm test is vitest run, npm run build is tsc and npm start runs the compiled entry", { timeout: 120000 }, async () => {
    const pkg = readJson("package.json");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(pkg.scripts.start).toBe("node dist/index.js");
    await build();
    expect(statSync(join(root, "dist", "index.js")).isFile()).toBe(true);
  });

  // @covers room-booking-api:CON-005
  it("package.json declares no runtime dependency and the compiled output imports only relative modules and node builtins", { timeout: 120000 }, async () => {
    const pkg = readJson("package.json");
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    await build();
    const specifiers = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) {
          const sf = ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.ES2022, true);
          sf.forEachChild((node) => {
            if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
              specifiers.add(node.moduleSpecifier.text);
            }
          });
        }
      }
    };
    walk(join(root, "dist"));
    expect(specifiers.has("node:http")).toBe(true);
    expect([...specifiers].filter((s) => !s.startsWith("./") && !s.startsWith("../") && !s.startsWith("node:"))).toEqual([]);
  });
});
