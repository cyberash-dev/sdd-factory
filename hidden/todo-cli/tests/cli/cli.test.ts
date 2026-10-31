import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, usageText } from "../../src/index.js";

const ROOT = process.cwd();

function tmpStore(): string {
  return join(mkdtempSync(join(tmpdir(), "todo-t004-")), "s.json");
}

async function run(args: string[], file: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, { TODO_FILE: file }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err };
}

describe("todo --help", () => {
  // @covers todo-cli:BEH-020
  it("prints a non-empty usage text to stdout, nothing to stderr, and creates no storage file when the storage file is absent", async () => {
    const file = tmpStore();
    const r = await run(["--help"], file);
    expect(r.code).toBe(0);
    expect(r.out.trim().length).toBeGreaterThan(0);
    expect(r.err).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it.each([
    ["empty store", '{"nextId":1,"tasks":[]}'],
    ["unparsable store", "{oops"],
  ])("leaves the %s byte-unchanged and still exits 0", async (_n, content) => {
    const file = tmpStore();
    writeFileSync(file, content);
    const r = await run(["--help"], file);
    expect(r.code).toBe(0);
    expect(r.out.trim().length).toBeGreaterThan(0);
    expect(r.err).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  it("exits 2 with E_USAGE_MISSING_ARGUMENT for a bare invocation and prints no usage text on stdout", async () => {
    const file = tmpStore();
    const r = await run([], file);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toEqual(["usage: missing argument"]);
    expect(existsSync(file)).toBe(false);
  });

  // @covers todo-cli:CTR-005
  it("honours the help contract: unparsable store untouched, bare invocation exit 2, list --help is E_USAGE_UNKNOWN_OPTION", async () => {
    const file = tmpStore();
    writeFileSync(file, "{oops");
    const help = await run(["--help"], file);
    expect(help.code).toBe(0);
    expect(help.out.trim().length).toBeGreaterThan(0);
    expect(help.err).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("{oops");

    const content = '{"nextId":1,"tasks":[]}';
    writeFileSync(file, content);
    const bare = await run([], file);
    expect(bare.code).toBe(2);
    expect(bare.out).toBe("");
    expect(bare.err).toEqual(["usage: missing argument"]);

    writeFileSync(file, '{"nextId":2,"tasks":[{"id":1,"text":"a","done":false,"createdAt":"2026-10-31T10:00:00.000Z"}]}');
    const lh = await run(["list", "--help"], file);
    expect(lh.code).toBe(2);
    expect(lh.out).toBe("");
    expect(lh.err).toEqual(["usage: unknown argument --help"]);
  });

  it("returns a non-empty multi-line usageText", () => {
    const t = usageText();
    expect(t.trim().length).toBeGreaterThan(0);
    expect(t.split("\n").length).toBeGreaterThan(1);
  });
});

describe("task lifecycle", () => {
  // @covers todo-cli:SCN-001
  it("runs add, list, done, list, list --all, rm, list with the listed stdout and exit 0 each", async () => {
    const file = tmpStore();
    const steps: [string[], string][] = [
      [["add", "buy milk"], "#1 buy milk"],
      [["list"], "#1 buy milk"],
      [["done", "1"], "#1 done"],
      [["list"], ""],
      [["list", "--all"], "[x] #1 buy milk"],
      [["rm", "1"], "#1 removed"],
      [["list"], ""],
    ];
    for (const [args, expected] of steps) {
      const r = await run(args, file);
      expect(r.code).toBe(0);
      expect(r.out).toBe(expected);
      expect(r.err).toEqual([]);
      expect(existsSync(file)).toBe(true);
    }
  });

  it("starts the lifecycle at id 6 for a populated store holding task 5 and nextId 6", async () => {
    const file = tmpStore();
    writeFileSync(file, '{"nextId":6,"tasks":[{"id":5,"text":"x","done":false,"createdAt":"2026-10-31T10:00:00.000Z"}]}');
    const add = await run(["add", "buy milk"], file);
    expect(add.code).toBe(0);
    expect(add.out).toBe("#6 buy milk");
    const done = await run(["done", "6"], file);
    expect(done.out).toBe("#6 done");
    const rm = await run(["rm", "6"], file);
    expect(rm.out).toBe("#6 removed");
  });

  // @covers todo-cli:SCN-002
  it("prints the identical line #1 done on two consecutive done invocations and keeps the task done", async () => {
    const file = tmpStore();
    writeFileSync(file, '{"nextId":2,"tasks":[{"id":1,"text":"a","done":false,"createdAt":"2026-10-31T10:00:00.000Z"}]}');
    const first = await run(["done", "1"], file);
    const second = await run(["done", "1"], file);
    expect(first.code).toBe(0);
    expect(first.out).toBe("#1 done");
    expect(second.code).toBe(0);
    expect(second.out).toBe("#1 done");
    expect(second.err).toEqual([]);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(stored.tasks[0].done).toBe(true);
  });

  it("exits 0 with #1 done for an already completed task", async () => {
    const file = tmpStore();
    writeFileSync(file, '{"nextId":2,"tasks":[{"id":1,"text":"a","done":true,"createdAt":"2026-10-31T10:00:00.000Z"}]}');
    const r = await run(["done", "1"], file);
    expect(r.code).toBe(0);
    expect(r.out).toBe("#1 done");
  });

  it("exits 1 with E_NO_TASK both times for done 1 on an empty store", async () => {
    const file = tmpStore();
    writeFileSync(file, '{"nextId":1,"tasks":[]}');
    for (let i = 0; i < 2; i++) {
      const r = await run(["done", "1"], file);
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toEqual(["error: no task #1"]);
    }
  });

  // @covers todo-cli:SCN-003
  it("hands out id 2 after the only task 1 was removed", async () => {
    const file = tmpStore();
    const a = await run(["add", "a"], file);
    const rm = await run(["rm", "1"], file);
    const b = await run(["add", "b"], file);
    expect([a.out, rm.out, b.out]).toEqual(["#1 a", "#1 removed", "#2 b"]);
    expect([a.code, rm.code, b.code]).toEqual([0, 0, 0]);
    expect([a.err, rm.err, b.err]).toEqual([[], [], []]);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(stored.tasks).toHaveLength(1);
    expect(stored.tasks[0].id).toBe(2);
  });

  it("hands out id 3 after the highest id 2 was removed", async () => {
    const file = tmpStore();
    await run(["add", "a"], file);
    await run(["add", "b"], file);
    await run(["rm", "2"], file);
    const c = await run(["add", "c"], file);
    expect(c.code).toBe(0);
    expect(c.out).toBe("#3 c");
  });
});

describe("constraints and build", () => {
  // @covers todo-cli:CON-001
  it("runs every command without calling fetch", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const file = tmpStore();
      const codes: number[] = [];
      for (const args of [["--help"], ["add", "a"], ["list"], ["list", "--all"], ["done", "1"], ["rm", "1"]]) {
        codes.push((await run(args, file)).code);
      }
      expect(codes).toEqual([0, 0, 0, 0, 0, 0]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // @covers todo-cli:CON-002
  it("declares no runtime dependency and the built CLI runs on the standard library alone", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
    const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
    expect(build.status).toBe(0);
    const r = spawnSync("node", ["dist/cli.js", "--help"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  }, 120000);

  // @covers todo-cli:NFR-001
  it("exits 0 for npm run build twice in a row", () => {
    for (let i = 0; i < 2; i++) {
      const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
      expect(build.status).toBe(0);
    }
    expect(existsSync(join(ROOT, "dist", "cli.js"))).toBe(true);
  }, 120000);

  // @covers todo-cli:GA-001
  it("produces dist/cli.js that answers node dist/cli.js --help with exit 0 after the build", () => {
    const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
    expect(build.status).toBe(0);
    expect(existsSync(join(ROOT, "dist", "cli.js"))).toBe(true);
    const file = tmpStore();
    const r = spawnSync("node", ["dist/cli.js", "--help"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, TODO_FILE: file },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    expect(r.stderr).toBe("");
    expect(existsSync(file)).toBe(false);
  }, 120000);
});
