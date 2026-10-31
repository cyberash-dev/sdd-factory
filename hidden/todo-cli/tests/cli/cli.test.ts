import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TIMEOUT = 120000;
const ALPHA = '[{"id":1,"text":"alpha","done":false,"createdAt":"2026-01-01T00:00:00.000Z"}]';

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST") || key === "NODE_OPTIONS" || key === "TODO_FILE") delete env[key];
  }
  return { ...env, ...extra };
}

function build() {
  return spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", env: cleanEnv({}) });
}

function sandbox(content: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "todo-cli-t005-"));
  const file = join(dir, "todo.json");
  if (content !== null) writeFileSync(file, content);
  return { dir, file };
}

function cli(args: string[], file: string, nodeArgs: string[] = [], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [...nodeArgs, join(root, "dist/cli.js"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: cleanEnv({ TODO_FILE: file, ...extraEnv }),
  });
}

function buildThenCli(args: string[], file: string) {
  const b = build();
  expect(b.status).toBe(0);
  return cli(args, file);
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function box(content: string | null) {
  const s = sandbox(content);
  dirs.push(s.dir);
  return s;
}

describe("CLI streams and exit codes", () => {
  // @covers todo-cli:INV-003
  it("a successful add exits 0 with the result line on stdout and nothing on stderr", () => {
    const { file } = box("[]");
    const r = buildThenCli(["add", "milk"], file);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("#1 milk\n");
    expect(r.stderr).toBe("");
  }, TIMEOUT);

  it("an add with blank text exits 2 with exactly one usage: line on stderr and no stdout", () => {
    const { file } = box(ALPHA);
    const r = buildThenCli(["add", ""], file);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^usage: [^\n]+\n$/);
  }, TIMEOUT);

  it("done on an absent id exits 1 with the single line error: no task #7", () => {
    const { file } = box(ALPHA);
    const r = buildThenCli(["done", "7"], file);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("error: no task #7\n");
  }, TIMEOUT);

  it("rm on an absent id exits 1 with the single line error: no task #9", () => {
    const { file } = box(ALPHA);
    const r = buildThenCli(["rm", "9"], file);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("error: no task #9\n");
  }, TIMEOUT);

  it("list over a storage file holding not-json exits 1 with the single line error: cannot read <path>", () => {
    const { file } = box("not-json");
    const r = buildThenCli(["list"], file);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`error: cannot read ${file}\n`);
  }, TIMEOUT);

  it("a storage path that is a directory is reported as one error: line with no stack trace", () => {
    const { dir } = box(null);
    const r = buildThenCli(["list"], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`error: cannot read ${dir}\n`);
  }, TIMEOUT);

  it.each([
    [[]],
    [["bogus"]],
    [["list", "--x"]],
    [["add", "a", "b"]],
    [["add"]],
    [["done", "0"]],
    [["rm", "01"]],
    [["done", "abc"]],
  ])("usage failure for argv %j exits 2 with one usage: line and no stdout", (argv) => {
    const { file } = box("[]");
    const r = buildThenCli(argv, file);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^usage: [^\n]+\n$/);
  }, TIMEOUT);

  it("--help exits 0 with the usage text naming every command on stdout and nothing on stderr", () => {
    const { file } = box("[]");
    const r = buildThenCli(["--help"], file);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    for (const token of ["add", "list", "done", "rm", "--help"]) expect(r.stdout).toContain(token);
  }, TIMEOUT);

  it.each([
    [["add", "milk"], "[]", 0],
    [["done", "7"], ALPHA, 1],
    [["add", ""], ALPHA, 2],
  ])("main returns the exit code for argv %j", (argv, content, code) => {
    const { file } = box(content);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(main(argv, { TODO_FILE: file }, root)).toBe(code);
  });
});

describe("product constraints", () => {
  // @covers todo-cli:CON-001
  it("strict TypeScript passes tsc --noEmit and the build emits an ESM CLI that runs", () => {
    const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.strict).toBe(true);
    const tsc = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(tsc.status).toBe(0);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.type).toBe("module");
    const { file } = box("[]");
    const r = buildThenCli(["--help"], file);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--help");
    expect(readFileSync(join(root, "dist/cli.js"), "utf8")).not.toMatch(/\brequire\(|module\.exports/);
  }, TIMEOUT);

  // @covers todo-cli:CON-002
  it("node dist/cli.js --help runs on Node.js 22 or newer", () => {
    expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(22);
    const { file } = box("[]");
    const r = buildThenCli(["--help"], file);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--help");
  }, TIMEOUT);

  // @covers todo-cli:CON-003
  it("npm test runs the suite with vitest and exits 0", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.test).toBe("vitest run");
    // filter to one finished module's tests so the nested run does not recurse into this file
    const t = spawnSync("npm", ["test", "--", "tests/errors"], { cwd: root, encoding: "utf8", env: cleanEnv({}) });
    expect(t.status).toBe(0);
    expect(t.stdout + t.stderr).toMatch(/Test Files\s+1 passed/);
    const { file } = box("[]");
    const h = buildThenCli(["--help"], file);
    expect([h.status, h.stdout.includes("--help")]).toEqual([0, true]);
  }, TIMEOUT);

  // @covers todo-cli:CON-004
  it("add, list and rm open no network connection", () => {
    const { dir, file } = box("[]");
    const hook = join(dir, "block-net.cjs");
    const log = join(dir, "net.log");
    writeFileSync(
      hook,
      [
        'const fs = require("fs");',
        "const hit = (w) => { fs.appendFileSync(process.env.NET_LOG, w + '\\n'); throw new Error('network blocked'); };",
        'require("net").Socket.prototype.connect = function () { hit("net.connect"); };',
        'require("dns").lookup = function () { hit("dns.lookup"); };',
        'globalThis.fetch = function () { hit("fetch"); };',
      ].join("\n"),
    );
    expect(build().status).toBe(0);
    const run = (args: string[]) => cli(args, file, ["--require", hook], { NET_LOG: log });
    const add = run(["add", "milk"]);
    expect([add.status, add.stdout, add.stderr]).toEqual([0, "#1 milk\n", ""]);
    const list = run(["list"]);
    expect([list.status, list.stdout, list.stderr]).toEqual([0, "#1 milk\n", ""]);
    const rm = run(["rm", "1"]);
    expect([rm.status, rm.stdout, rm.stderr]).toEqual([0, "#1 removed\n", ""]);
    expect(existsSync(log)).toBe(false);
  }, TIMEOUT);

  // @covers todo-cli:CON-005
  it("package.json lists no run-time dependency and dist/cli.js runs without node_modules", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(build().status).toBe(0);
    const { dir, file } = box("[]");
    const copy = join(dir, "app");
    mkdirSync(copy);
    cpSync(join(root, "dist"), join(copy, "dist"), { recursive: true });
    writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
    const r = spawnSync(process.execPath, [join(copy, "dist/cli.js"), "add", "milk"], {
      cwd: copy,
      encoding: "utf8",
      env: cleanEnv({ TODO_FILE: file }),
    });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "#1 milk\n", ""]);
  }, TIMEOUT);

  // @covers todo-cli:CON-006
  it("npm run build from a clean tree exits 0, emits dist/cli.js and node dist/cli.js --help runs", () => {
    rmSync(join(root, "dist"), { recursive: true, force: true });
    const b = build();
    expect(b.status).toBe(0);
    expect(existsSync(join(root, "dist/cli.js"))).toBe(true);
    const { file } = box("[]");
    const r = cli(["--help"], file);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    for (const token of ["add", "list", "done", "rm", "--help"]) expect(r.stdout).toContain(token);
  }, TIMEOUT);

  it("npm run build over an existing dist exits 0 and node dist/cli.js still runs", () => {
    expect(build().status).toBe(0);
    const again = build();
    expect(again.status).toBe(0);
    const { file } = box("[]");
    const r = cli(["add", "milk"], file);
    expect([r.status, r.stdout]).toEqual([0, "#1 milk\n"]);
  }, TIMEOUT);
});
