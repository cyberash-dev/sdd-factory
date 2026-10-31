import { describe, it, expect } from "vitest";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { startServer } from "../../src/app/index.js";

const run = promisify(execFile);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

async function startedProcessAnswers(port: number, env: Record<string, string | undefined>): Promise<Response> {
  await run("npm", ["run", "build"], { cwd: process.cwd() });
  const merged = { ...process.env, ...env };
  if (env.PORT === undefined) delete merged.PORT;
  const child = spawn("npm", ["start"], { cwd: process.cwd(), env: merged, detached: true, stdio: "ignore" });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  try {
    const deadline = Date.now() + 60000;
    for (;;) {
      try {
        return await fetch(`http://127.0.0.1:${port}/rooms`);
      } catch (err) {
        if (exited || Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  } finally {
    try {
      process.kill(-(child.pid as number), "SIGKILL");
    } catch {
      // already gone
    }
  }
}

describe("process wiring", () => {
  // @covers room-booking-api:CN-001
  it("serves requests while package.json declares no runtime dependency", async () => {
    const running = await startServer(0);
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/rooms`);
      expect(res.status).toBe(200);
    } finally {
      await running.close();
    }
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  // @covers room-booking-api:CN-002
  it("listens on the port from PORT when started with npm start after npm run build", async () => {
    const port = await freePort();
    const res = await startedProcessAnswers(port, { PORT: String(port) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rooms: [] });
  }, 120000);

  it("listens on 3000 when PORT is unset", async () => {
    const res = await startedProcessAnswers(3000, { PORT: undefined });
    expect(res.status).toBe(200);
  }, 120000);

  // @covers room-booking-api:CN-003
  it("builds without a type error and serves an ephemeral port bound by startServer(0)", async () => {
    const built = await run("npm", ["run", "build"], { cwd: process.cwd() });
    expect(built.stderr).not.toMatch(/error TS/);
    const running = await startServer(0);
    try {
      expect(running.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${running.port}/rooms`);
      expect(res.status).toBe(200);
    } finally {
      await running.close();
    }
  }, 120000);
});
