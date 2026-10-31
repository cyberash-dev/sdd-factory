import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAdd, runDone, runRm } from "../../src/write-commands/index.js";

interface Seed {
  id: number;
  text: string;
  done: boolean;
  createdAt: string;
}

const T = (id: number, text: string, done = false): Seed => ({
  id,
  text,
  done,
  createdAt: "2026-01-01T00:00:00.000Z",
});

function setup(content?: string | Seed[]): { path: string } {
  const dir = mkdtempSync(join(tmpdir(), "todo-t004-"));
  const path = join(dir, "todo.json");
  if (content !== undefined) {
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return { path };
}

const raw = (path: string): string => readFileSync(path, "utf8");
const stored = (path: string): Seed[] => JSON.parse(raw(path)) as Seed[];
const NOW = new Date("2026-10-31T12:00:00.000Z");

const noTask = (id: number) => ({
  ok: false,
  error: { code: "E_NO_TASK", exitCode: 1, message: `error: no task #${id}` },
});
const storageFail = (path: string) => ({
  ok: false,
  error: { code: "E_STORAGE", exitCode: 1, message: `error: cannot read ${path}` },
});

describe("add command", () => {
  // @covers todo-cli:BEH-001
  it("add prints #<id> <text> and appends one task to the storage file", () => {
    const { path } = setup([T(1, "alpha"), T(2, "beta")]);
    const result = runAdd(path, "milk", NOW);
    expect(result).toEqual({ ok: true, stdout: "#3 milk\n" });
    const tasks = stored(path);
    expect(tasks).toHaveLength(3);
    expect(tasks[2]).toEqual({ id: 3, text: "milk", done: false, createdAt: "2026-10-31T12:00:00.000Z" });
    expect(tasks[0]).toEqual(T(1, "alpha"));
  });

  // @covers todo-cli:CTR-001
  it("add succeeds on an absent storage file and creates it", () => {
    const { path } = setup();
    expect(existsSync(path)).toBe(false);
    expect(runAdd(path, "milk", NOW)).toEqual({ ok: true, stdout: "#1 milk\n" });
    expect(stored(path).map((t) => t.text)).toEqual(["milk"]);
  });

  it.each([
    ["buy milk and bread"],
    ["milk, eggs & bread!"],
    ["  padded  text "],
  ])("add keeps the text %j byte for byte", (text) => {
    const { path } = setup("[]");
    expect(runAdd(path, text, NOW)).toEqual({ ok: true, stdout: `#1 ${text}\n` });
    expect(stored(path)[0]?.text).toBe(text);
  });

  it("add on an unreadable storage file fails with E_STORAGE and leaves it untouched", () => {
    const { path } = setup("not-json");
    expect(runAdd(path, "milk", NOW)).toEqual(storageFail(path));
    expect(raw(path)).toBe("not-json");
  });
});

describe("done command", () => {
  // @covers todo-cli:BEH-008
  it("done marks the named open task and prints #<id> done", () => {
    const { path } = setup([T(1, "alpha"), T(2, "beta")]);
    expect(runDone(path, 2)).toEqual({ ok: true, stdout: "#2 done\n" });
    expect(stored(path)).toEqual([T(1, "alpha"), T(2, "beta", true)]);
  });

  it.each([
    [1, [T(1, "alpha"), T(3, "gamma")], [T(1, "alpha", true), T(3, "gamma")]],
    [3, [T(1, "alpha"), T(3, "gamma")], [T(1, "alpha"), T(3, "gamma", true)]],
  ])("done %i marks exactly that task", (id, seed, expected) => {
    const { path } = setup(seed);
    expect(runDone(path, id)).toEqual({ ok: true, stdout: `#${id} done\n` });
    expect(stored(path)).toEqual(expected);
  });

  // @covers todo-cli:BEH-009
  it("done on a completed task repeats the output and leaves the file byte-identical", () => {
    const { path } = setup([T(1, "alpha"), T(2, "beta", true)]);
    const before = raw(path);
    expect(runDone(path, 2)).toEqual({ ok: true, stdout: "#2 done\n" });
    expect(raw(path)).toBe(before);
    expect(runDone(path, 2)).toEqual({ ok: true, stdout: "#2 done\n" });
    expect(raw(path)).toBe(before);
    expect(stored(path).filter((t) => t.id === 2)).toHaveLength(1);
  });

  // @covers todo-cli:BEH-010
  it("done of an unknown id fails with E_NO_TASK on an empty file and changes nothing", () => {
    const { path } = setup("[]");
    expect(runDone(path, 7)).toEqual(noTask(7));
    expect(raw(path)).toBe("[]");
  });

  it.each([
    [2, [T(1, "alpha"), T(3, "gamma")]],
    [7, [T(1, "alpha"), T(2, "beta")]],
    [99, [T(2, "beta")]],
  ])("done %i of an id missing from the storage file fails with E_NO_TASK", (id, seed) => {
    const { path } = setup(seed);
    const before = raw(path);
    expect(runDone(path, id)).toEqual(noTask(id));
    expect(raw(path)).toBe(before);
  });

  it("done of an unknown id on an absent storage file fails with E_NO_TASK and creates no file", () => {
    const { path } = setup();
    expect(runDone(path, 7)).toEqual(noTask(7));
    expect(existsSync(path)).toBe(false);
  });

  // @covers todo-cli:CTR-003
  it("done on an unreadable storage file fails with E_STORAGE and leaves it untouched", () => {
    const { path } = setup("not-json");
    expect(runDone(path, 1)).toEqual(storageFail(path));
    expect(raw(path)).toBe("not-json");
  });
});

describe("rm command", () => {
  // @covers todo-cli:BEH-011
  it("rm deletes exactly the named task and prints #<id> removed", () => {
    const { path } = setup([T(1, "alpha"), T(2, "beta")]);
    expect(runRm(path, 1)).toEqual({ ok: true, stdout: "#1 removed\n" });
    expect(stored(path)).toEqual([T(2, "beta")]);
  });

  it("rm of the last task keeps the first", () => {
    const { path } = setup([T(1, "alpha"), T(2, "beta")]);
    expect(runRm(path, 2)).toEqual({ ok: true, stdout: "#2 removed\n" });
    expect(stored(path)).toEqual([T(1, "alpha")]);
  });

  it("rm of the only task leaves an empty JSON array", () => {
    const { path } = setup([T(1, "alpha")]);
    expect(runRm(path, 1)).toEqual({ ok: true, stdout: "#1 removed\n" });
    expect(stored(path)).toEqual([]);
  });

  // @covers todo-cli:BEH-012
  it("rm of an unknown id fails with E_NO_TASK on an empty file and changes nothing", () => {
    const { path } = setup("[]");
    expect(runRm(path, 4)).toEqual(noTask(4));
    expect(raw(path)).toBe("[]");
  });

  it.each([
    [2, [T(1, "alpha"), T(3, "gamma")]],
    [4, [T(1, "alpha"), T(2, "beta")]],
    [9, [T(1, "alpha"), T(2, "beta")]],
  ])("rm %i of an id missing from the storage file fails with E_NO_TASK and keeps all tasks", (id, seed) => {
    const { path } = setup(seed);
    const before = raw(path);
    expect(runRm(path, id)).toEqual(noTask(id));
    expect(raw(path)).toBe(before);
  });

  // @covers todo-cli:CTR-004
  it("rm on an unreadable storage file fails with E_STORAGE and leaves it untouched", () => {
    const { path } = setup("not-json");
    expect(runRm(path, 1)).toEqual(storageFail(path));
    expect(raw(path)).toBe("not-json");
  });
});
