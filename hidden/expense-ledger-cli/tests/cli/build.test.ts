import { describe, it, expect } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const LONG = 120000;
const TODAY_UTC = (): string => new Date().toISOString().slice(0, 10);

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("VITEST") && k !== "LEDGER_FILE") env[k] = v;
  }
  return { ...env, ...extra };
}

function sh(cmd: string, args: string[], cwd: string, extra: Record<string, string> = {}): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, { cwd, env: cleanEnv(extra), encoding: "utf8", timeout: 110000 });
}

function build(): void {
  const r = sh("npm", ["run", "build"], ROOT);
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(existsSync(join(ROOT, "dist", "cli.js"))).toBe(true);
}

function cli(cwd: string, ...args: string[]): SpawnSyncReturns<string> {
  return sh("node", [join(ROOT, "dist", "cli.js"), ...args], cwd);
}

function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

function importedSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g;
  for (let m = re.exec(source); m; m = re.exec(source)) specs.push(m[1] ?? "");
  return specs;
}

describe("built CLI dist/cli.js", () => {
  // @covers expense-ledger-cli:GEN-001
  it("exists after npm run build and node dist/cli.js --help exits 0 naming the commands", () => {
    build();
    const r = cli(ROOT, "--help");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    for (const word of ["add", "list", "summary", "rm", "export", "--help"]) expect(r.stdout).toContain(word);
  }, LONG);

  // @covers expense-ledger-cli:CON-006
  it("runs add and list as node dist/cli.js with the default ./ledger.json in the working directory", () => {
    build();
    const cwd = mkdtempSync(join(tmpdir(), "ledger-bin-"));
    const a = cli(cwd, "add", "12.50", "food");
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(`#1 12.50 food ${TODAY_UTC()}\n`);
    expect(existsSync(join(cwd, "ledger.json"))).toBe(true);
    const l = cli(cwd, "list");
    expect(l.status).toBe(0);
    expect(l.stdout).toBe(`#1 ${TODAY_UTC()} 12.50 food\n`);
  }, LONG);

  // @covers expense-ledger-cli:CON-001
  it("passes the strict typecheck and the emitted ES module entry runs", () => {
    const t = sh("npx", ["tsc", "--noEmit"], ROOT);
    expect(t.status, t.stdout + t.stderr).toBe(0);
    const tsconfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8")) as {
      compilerOptions: { strict: boolean };
    };
    expect(tsconfig.compilerOptions.strict).toBe(true);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { type?: string };
    expect(pkg.type).toBe("module");
    build();
    expect(cli(ROOT, "--help").status).toBe(0);
  }, LONG);

  // @covers expense-ledger-cli:CON-002
  it("runs under Node.js 22 or newer", () => {
    expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(22);
    build();
    const v = sh("node", ["--version"], ROOT);
    expect(Number((v.stdout.trim().replace(/^v/, "")).split(".")[0])).toBeGreaterThanOrEqual(22);
    const cwd = mkdtempSync(join(tmpdir(), "ledger-node-"));
    const r = cli(cwd, "summary");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("total 0.00\n");
  }, LONG);

  // @covers expense-ledger-cli:CON-003
  it("npm test runs the vitest suite and exits 0", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test"]).toBe("vitest run");
    // this file would recurse, so the nested run targets the in-process suite
    const r = sh("npm", ["test", "--", "tests/cli/main.test.ts"], ROOT);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Test Files\s+\d+ passed/);
  }, LONG);

  // @covers expense-ledger-cli:CON-004
  it("every command succeeds and the built code references no network module", () => {
    build();
    const cwd = mkdtempSync(join(tmpdir(), "ledger-net-"));
    const steps: [string[], number][] = [
      [["--help"], 0],
      [["add", "12.50", "food"], 0],
      [["list"], 0],
      [["summary"], 0],
      [["export", "--csv"], 0],
      [["rm", "1"], 0],
    ];
    for (const [args, status] of steps) expect(cli(cwd, ...args).status, args.join(" ")).toBe(status);
    const network = /^(?:node:)?(?:http|https|http2|net|dgram|dns|tls|dns\/promises)$/;
    for (const file of jsFiles(join(ROOT, "dist"))) {
      const src = readFileSync(file, "utf8");
      expect(importedSpecifiers(src).filter((s) => network.test(s)), file).toEqual([]);
      expect(src, file).not.toMatch(/\bfetch\s*\(/);
    }
  }, LONG);

  // @covers expense-ledger-cli:CON-005
  it("declares no runtime dependencies and the built code imports only node: builtins or relative files", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    build();
    for (const file of jsFiles(join(ROOT, "dist"))) {
      const bad = importedSpecifiers(readFileSync(file, "utf8")).filter(
        (s) => !s.startsWith("node:") && !s.startsWith("./") && !s.startsWith("../"),
      );
      expect(bad, file).toEqual([]);
    }
    expect(cli(ROOT, "--help").status).toBe(0);
  }, LONG);
});
