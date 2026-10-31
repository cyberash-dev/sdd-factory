import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
const LONG = 90_000;

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function run(cmd: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: 80_000 }, (error, out, err) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ code, out, err });
    });
  });
}

async function build(): Promise<{ dir: string; result: Run }> {
  const dir = mkdtempSync(join(tmpdir(), "t005-build-"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  const result = await run(TSC, ["-p", "tsconfig.build.json", "--outDir", dir]);
  return { dir, result };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function startProcess(dir: string, port: string | undefined): { child: ChildProcess; err: () => string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PORT;
  if (port !== undefined) env.PORT = port;
  const child = spawn(process.execPath, [join(dir, "index.js")], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
  child.stdout?.resume();
  return { child, err: () => err };
}

async function answers(port: number, deadlineMs = 10_000): Promise<Response | undefined> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try {
      return await fetch(`http://127.0.0.1:${port}/links/unknowncode`);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return undefined;
}

function exited(child: ChildProcess, ms: number): Promise<number | null | "timeout"> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const t = setTimeout(() => resolve("timeout"), ms);
    child.once("exit", (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
}

async function checkListening(portEnv: string | undefined, port: number): Promise<void> {
  const { dir, result } = await build();
  expect(result.code).toBe(0);
  const { child } = startProcess(dir, portEnv);
  try {
    const res = await answers(port);
    expect(res, `no answer on port ${port}`).toBeDefined();
    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "not_found" });
    const created = await fetch(`http://127.0.0.1:${port}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"url":"https://example.com/p"}',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { code: string; shortUrl: string };
    expect(body.shortUrl).toBe(`http://localhost:${port}/${body.code}`);
  } finally {
    child.kill("SIGKILL");
  }
}

describe("process configuration", () => {
  // @covers url-shortener-api:BEH-013
  it("answers on the port given by PORT and carries it in shortUrl", async () => {
    const port = await freePort();
    await checkListening(String(port), port);
  }, LONG);

  // @covers url-shortener-api:BEH-014
  it("answers on port 3000 when PORT is unset", async () => {
    await checkListening(undefined, 3000);
  }, LONG);

  it("answers on port 3000 when PORT is an empty string", async () => {
    await checkListening("", 3000);
  }, LONG);

  // @covers url-shortener-api:BEH-015
  it("exits non-zero reporting invalid_port when PORT is not a port number", async () => {
    const { dir, result } = await build();
    expect(result.code).toBe(0);
    for (const value of ["abc", "70000"]) {
      const { child, err } = startProcess(dir, value);
      try {
        const code = await exited(child, 15_000);
        expect(code, `PORT=${value}`).not.toBe("timeout");
        expect(code, `PORT=${value}`).not.toBe(0);
        expect(code).not.toBeNull();
        expect(err()).toContain("invalid_port");
      } finally {
        child.kill("SIGKILL");
      }
    }
  }, LONG);
});

describe("build and package scripts", () => {
  // @covers url-shortener-api:CON-001
  it("declares a strict ES module TypeScript service with build, test and start scripts", async () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      type: string;
      engines: { node: string };
      scripts: Record<string, string>;
    };
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=22");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(pkg.scripts.start).toBe("node build/index.js");
    const shown = await run(TSC, ["-p", "tsconfig.build.json", "--showConfig"]);
    expect(shown.code).toBe(0);
    const cfg = JSON.parse(shown.out) as { compilerOptions: Record<string, unknown> };
    expect(cfg.compilerOptions.strict).toBe(true);
    expect(String(cfg.compilerOptions.module).toLowerCase()).toBe("nodenext");
    expect(cfg.compilerOptions.noEmit).not.toBe(true);
    expect(cfg.compilerOptions.outDir).toMatch(/build$/);
  }, LONG);

  // @covers url-shortener-api:NFR-001
  it("builds with exit status 0 and no diagnostics", async () => {
    const { result } = await build();
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe("");
    expect(result.err.trim()).toBe("");
  }, LONG);

  // @covers url-shortener-api:GA-001
  it("produces the build output that npm start executes, also when rebuilt over existing output", async () => {
    const { dir, result } = await build();
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, "index.js"))).toBe(true);
    const again = await run(TSC, ["-p", "tsconfig.build.json", "--outDir", dir]);
    expect(again.code).toBe(0);
    expect(existsSync(join(dir, "index.js"))).toBe(true);
    const port = await freePort();
    const { child } = startProcess(dir, String(port));
    try {
      const res = await answers(port);
      expect(res?.status).toBe(404);
    } finally {
      child.kill("SIGKILL");
    }
  }, LONG);
});
