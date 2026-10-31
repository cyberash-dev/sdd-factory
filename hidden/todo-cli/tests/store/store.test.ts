import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTask,
  nextTaskId,
  readTasks,
  resolveStoragePath,
  writeTasks,
} from "../../src/store/index.js";
import type { Task } from "../../src/store/index.js";

const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "todo-store-"));
}

function seed(id: number, text: string, done = false): Task {
  return { id, text, done, createdAt: "2026-10-31T01:58:10.267Z" };
}

// Mirrors what `add` does: read, allocate, stamp, write.
function addTask(env: NodeJS.ProcessEnv, cwd: string, text: string): Task {
  const path = resolveStoragePath(env, cwd);
  const read = readTasks(path);
  if (!read.ok) throw new Error("unreadable store");
  const task = createTask(nextTaskId(read.tasks), text, new Date());
  const written = writeTasks(path, [...read.tasks, task]);
  if (!written.ok) throw new Error("unwritable store");
  return task;
}

function stored(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("storage path", () => {
  it("uses TODO_FILE when set and ./todo.json in the current directory otherwise", () => {
    expect(resolveStoragePath({ TODO_FILE: "/data/alt.json" }, "/work")).toBe("/data/alt.json");
    expect(resolveStoragePath({}, "/work")).toBe("/work/todo.json");
    expect(resolve("/work", resolveStoragePath({ TODO_FILE: "./alt.json" }, "/work"))).toBe(
      "/work/alt.json",
    );
  });
});

describe("storage file", () => {
  // @covers todo-cli:BEH-003
  it("first add creates the storage file holding one task", () => {
    const dir = tmp();
    const task = addTask({}, dir, "first");
    expect(task.id).toBe(1);
    expect(task.text).toBe("first");
    const file = join(dir, "todo.json");
    expect(existsSync(file)).toBe(true);
    const items = stored(file) as Task[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 1, text: "first", done: false });
  });

  it("first add at a TODO_FILE path creates only that file", () => {
    const dir = tmp();
    addTask({ TODO_FILE: join(dir, "custom.json") }, dir, "first");
    expect(existsSync(join(dir, "custom.json"))).toBe(true);
    expect(existsSync(join(dir, "todo.json"))).toBe(false);
  });

  // @covers todo-cli:BEH-004
  it.each([
    { name: "gap in ids", ids: [1, 3], next: 4 },
    { name: "contiguous ids", ids: [1, 2, 3], next: 4 },
    { name: "highest id removed", ids: [1, 2], next: 3 },
    { name: "empty list", ids: [] as number[], next: 1 },
  ])("add assigns the next integer id: $name", ({ ids, next }) => {
    const dir = tmp();
    const file = join(dir, "todo.json");
    writeFileSync(file, JSON.stringify(ids.map((id) => seed(id, `t${id}`))));
    const task = addTask({}, dir, "next");
    expect(task.id).toBe(next);
    const items = stored(file) as Task[];
    expect(items.filter((t) => t.id === next)).toHaveLength(1);
    expect(items.every((t) => t.id > 0)).toBe(true);
  });

  it("add on an absent storage file gives the new task id 1", () => {
    expect(addTask({}, tmp(), "next").id).toBe(1);
  });

  // @covers todo-cli:BEH-017
  it.each([
    { name: "default path", env: {} as NodeJS.ProcessEnv, file: "todo.json" },
    { name: "TODO_FILE path", env: { TODO_FILE: "custom.json" }, file: "custom.json" },
  ])("absent storage file reads as an empty list and is not created: $name", ({ env, file }) => {
    const dir = tmp();
    const path = resolveStoragePath(
      env.TODO_FILE ? { TODO_FILE: join(dir, env.TODO_FILE) } : env,
      dir,
    );
    expect(readTasks(path)).toEqual({ ok: true, tasks: [] });
    expect(existsSync(join(dir, file))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reading an existing empty array leaves the file byte-identical", () => {
    const dir = tmp();
    const file = join(dir, "todo.json");
    writeFileSync(file, "[]");
    expect(readTasks(file)).toEqual({ ok: true, tasks: [] });
    expect(readFileSync(file, "utf8")).toBe("[]");
  });

  // @covers todo-cli:BEH-018
  it.each([
    { name: "malformed JSON", content: "{ not json" },
    { name: "JSON object instead of array", content: '{"tasks":[]}' },
    { name: "empty file", content: "" },
    { name: "item without createdAt", content: '[{"id":1,"text":"a","done":false}]' },
  ])("unparseable storage file is a storage failure naming the path: $name", ({ content }) => {
    const dir = tmp();
    const file = join(dir, "broken.json");
    writeFileSync(file, content);
    expect(readTasks(file)).toEqual({ ok: false, path: file });
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  it("parseable storage file reads ok", () => {
    const dir = tmp();
    const file = join(dir, "todo.json");
    writeFileSync(file, "[]");
    expect(readTasks(file).ok).toBe(true);
  });

  it("write to an unwritable path reports the path", () => {
    const file = join(tmp(), "missing-dir", "todo.json");
    expect(writeTasks(file, [seed(1, "a")])).toEqual({ ok: false, path: file });
  });

  // @covers todo-cli:BEH-019
  it("TODO_FILE receives the write and the default path is not created", () => {
    const dir = tmp();
    const alt = join(dir, "alt.json");
    const task = addTask({ TODO_FILE: alt }, dir, "env");
    expect(task.id).toBe(1);
    expect((stored(alt) as Task[]).map((t) => t.text)).toEqual(["env"]);
    expect(existsSync(join(dir, "todo.json"))).toBe(false);
  });

  it("TODO_FILE leaves an existing default file untouched", () => {
    const dir = tmp();
    const def = join(dir, "todo.json");
    const before = JSON.stringify([seed(1, "default")]);
    writeFileSync(def, before);
    addTask({ TODO_FILE: "./alt.json" }, dir, "env");
    expect(readFileSync(def, "utf8")).toBe(before);
    expect(existsSync(join(dir, "alt.json"))).toBe(true);
  });

  it("unset TODO_FILE writes to ./todo.json", () => {
    const dir = tmp();
    expect(addTask({}, dir, "env").id).toBe(1);
    expect((stored(join(dir, "todo.json")) as Task[])[0]?.text).toBe("env");
  });
});

describe("storage file format", () => {
  // @covers todo-cli:CTR-006
  it("first write leaves a JSON array whose item has the four fields and a millisecond Z createdAt", () => {
    const dir = tmp();
    addTask({}, dir, "milk");
    const items = stored(join(dir, "todo.json"));
    expect(Array.isArray(items)).toBe(true);
    const list = items as Task[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 1, text: "milk", done: false });
    expect(list[0]?.createdAt).toMatch(CREATED_AT);
    expect(Number.isNaN(Date.parse(list[0]?.createdAt ?? ""))).toBe(false);
  });

  it("write over an existing file keeps the first item and appends a well-formed second", () => {
    const dir = tmp();
    const file = join(dir, "todo.json");
    writeFileSync(file, JSON.stringify([seed(1, "alpha")]));
    addTask({}, dir, "eggs");
    const items = stored(file) as Task[];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: 1,
      text: "alpha",
      done: false,
      createdAt: "2026-10-31T01:58:10.267Z",
    });
    expect(items[1]).toMatchObject({ id: 2, text: "eggs", done: false });
    expect(items[1]?.createdAt).toMatch(CREATED_AT);
  });

  it("writing an empty list leaves a JSON array with no item", () => {
    const dir = tmp();
    const file = join(dir, "todo.json");
    writeFileSync(file, JSON.stringify([seed(1, "a")]));
    expect(writeTasks(file, [])).toEqual({ ok: true });
    expect(stored(file)).toEqual([]);
  });

  it("createTask stamps createdAt as UTC ISO-8601 with milliseconds and a Z suffix", () => {
    expect(createTask(5, "x", new Date("2026-10-31T01:58:10.267Z"))).toEqual({
      id: 5,
      text: "x",
      done: false,
      createdAt: "2026-10-31T01:58:10.267Z",
    });
    expect(createTask(1, "x", new Date("2026-01-02T03:04:05.000Z")).createdAt).toBe(
      "2026-01-02T03:04:05.000Z",
    );
  });
});

describe("stored task fields", () => {
  // @covers todo-cli:INV-001
  it("every stored task carries the four task fields with the stated types", () => {
    const dir = tmp();
    addTask({}, dir, "alpha");
    addTask({}, dir, "beta");
    const file = join(dir, "todo.json");
    const read = readTasks(file);
    if (!read.ok) throw new Error("unreadable");
    const completed = read.tasks.map((t) => (t.id === 1 ? { ...t, done: true } : t));
    expect(writeTasks(file, completed)).toEqual({ ok: true });
    const items = stored(file) as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(Number.isInteger(item.id)).toBe(true);
      expect(typeof item.text).toBe("string");
      expect(typeof item.done).toBe("boolean");
      expect(typeof item.createdAt).toBe("string");
      expect(item.createdAt).toMatch(CREATED_AT);
    }
    expect(items[0]?.done).toBe(true);
  });
});

describe("stored task ids", () => {
  // @covers todo-cli:INV-002
  it("ids stay positive, unique and unchanged across add, rm and done", () => {
    const dir = tmp();
    const file = join(dir, "todo.json");
    for (const text of ["alpha", "beta", "gamma"]) addTask({}, dir, text);
    expect((stored(file) as Task[]).map((t) => t.id)).toEqual([1, 2, 3]);

    writeFileSync(file, JSON.stringify([seed(1, "alpha"), seed(2, "beta")]));
    const read = readTasks(file);
    if (!read.ok) throw new Error("unreadable");
    writeTasks(file, read.tasks.filter((t) => t.id !== 1));
    const added = addTask({}, dir, "gamma");
    const ids = (stored(file) as Task[]).map((t) => t.id);
    expect(added.id).not.toBe(2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(2);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);

    writeFileSync(file, JSON.stringify([seed(1, "alpha"), seed(2, "beta")]));
    const again = readTasks(file);
    if (!again.ok) throw new Error("unreadable");
    writeTasks(file, again.tasks.map((t) => (t.id === 1 ? { ...t, done: true } : t)));
    expect((stored(file) as Task[]).map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("read-only access", () => {
  // @covers todo-cli:INV-004
  it("reading a missing file creates nothing, reading an existing file changes nothing, only a write creates it", () => {
    const dir = tmp();
    const file = join(dir, "todo.json");
    expect(readTasks(file)).toEqual({ ok: true, tasks: [] });
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);

    writeFileSync(file, "[]");
    readTasks(file);
    expect(readFileSync(file, "utf8")).toBe("[]");

    const other = tmp();
    addTask({}, other, "x");
    expect(existsSync(join(other, "todo.json"))).toBe(true);
  });
});
