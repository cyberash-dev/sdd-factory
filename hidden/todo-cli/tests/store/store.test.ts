import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyTaskList,
  formatCreatedAt,
  readTaskList,
  resolveStorePath,
  writeTaskList,
} from "../../src/store/index.js";
import type { Task, TaskList } from "../../src/store/index.js";

const TS = "2026-10-31T10:20:34.541Z";
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function dir(): string {
  return mkdtempSync(join(tmpdir(), "store-t002-"));
}
function task(id: number, text = `t${id}`, done = false): Task {
  return { id, text, done, createdAt: TS };
}
function list(nextId: number, tasks: Task[]): TaskList {
  return { nextId, tasks };
}
function tl(nextId: unknown, tasks: unknown): string {
  return JSON.stringify({ nextId, tasks });
}

const UNPARSABLE: Array<[string, string]> = [
  ["truncated JSON", '{"nextId":1,"tasks":['],
  ["empty file", ""],
  ["non-JSON text", "not a task list"],
  ["brace garbage", "{oops"],
];

const FOREIGN: Array<[string, string]> = [
  ["object without contract keys", '{"hello": 1}'],
  ["array at the root", "[]"],
  ["number scalar", "42"],
  ["null scalar", "null"],
  ["string scalar", '"x"'],
  ["missing tasks", '{"nextId":1}'],
  ["missing nextId", '{"tasks":[]}'],
  ["nextId zero", tl(0, [])],
  ["nextId fractional", tl(1.5, [])],
  ["nextId string", tl("1", [])],
  ["tasks not an array", tl(1, {})],
  ["task is not an object", tl(2, [1])],
  ["task id zero", tl(2, [{ id: 0, text: "a", done: false, createdAt: TS }])],
  ["task id fractional", tl(2, [{ id: 1.5, text: "a", done: false, createdAt: TS }])],
  ["task text empty", tl(2, [{ id: 1, text: "", done: false, createdAt: TS }])],
  ["task done not boolean", tl(2, [{ id: 1, text: "a", done: "no", createdAt: TS }])],
  ["task without createdAt", tl(2, [{ id: 1, text: "a", done: false }])],
  ["createdAt not a string", tl(2, [{ id: 1, text: "a", done: false, createdAt: 5 }])],
  ["createdAt wrong format", tl(2, [{ id: 1, text: "a", done: false, createdAt: "2026-10-31" }])],
  ["task without id", tl(2, [{ text: "a", done: false, createdAt: TS }])],
  [
    "duplicate ids",
    tl(2, [
      { id: 1, text: "a", done: false, createdAt: TS },
      { id: 1, text: "b", done: false, createdAt: TS },
    ]),
  ],
  [
    "descending ids",
    tl(3, [
      { id: 2, text: "a", done: false, createdAt: TS },
      { id: 1, text: "b", done: false, createdAt: TS },
    ]),
  ],
];

describe("storage path (CTR-007)", () => {
  // @covers todo-cli:CTR-007
  it("resolves TODO_FILE verbatim when set and non-empty, ./todo.json otherwise", () => {
    expect(resolveStorePath({})).toBe("./todo.json");
    expect(resolveStorePath({ TODO_FILE: undefined })).toBe("./todo.json");
    expect(resolveStorePath({ TODO_FILE: "" })).toBe("./todo.json");
    expect(resolveStorePath({ TODO_FILE: "/tmp/v/abs.json" })).toBe("/tmp/v/abs.json");
    expect(resolveStorePath({ TODO_FILE: "sub/store.json" })).toBe("sub/store.json");
    expect(resolveStorePath({ TODO_FILE: "/tmp/v/a b.json" })).toBe("/tmp/v/a b.json");
  });
});

describe("storage file format (CTR-006)", () => {
  it("emptyTaskList is nextId 1 with no tasks", () => {
    expect(emptyTaskList()).toEqual({ nextId: 1, tasks: [] });
  });

  it("formatCreatedAt renders YYYY-MM-DDTHH:MM:SS.sssZ in UTC", () => {
    expect(formatCreatedAt(new Date("2026-10-31T10:20:34.541Z"))).toBe("2026-10-31T10:20:34.541Z");
    expect(formatCreatedAt(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
  });

  // @covers todo-cli:CTR-006
  it("writes a root object with nextId and tasks and reads it back in ascending id order", () => {
    const p = join(dir(), "s.json");
    const written = list(4, [task(1, "a"), task(2, "b", true), task(3, "c")]);
    expect(writeTaskList(p, written)).toEqual({ ok: true, value: null });
    const raw = JSON.parse(readFileSync(p, "utf8"));
    expect(Array.isArray(raw)).toBe(false);
    expect(Object.keys(raw).sort()).toEqual(["nextId", "tasks"]);
    expect(raw.nextId).toBe(4);
    expect(raw.tasks.map((t: Task) => t.id)).toEqual([1, 2, 3]);
    for (const t of raw.tasks) expect(Object.keys(t).sort()).toEqual(["createdAt", "done", "id", "text"]);
    expect(readTaskList(p)).toEqual({ ok: true, value: written });
  });

  it.each(FOREIGN)("reports a file of another shape (%s) as not ok", (_n, content) => {
    const p = join(dir(), "s.json");
    writeFileSync(p, content);
    expect(readTaskList(p)).toEqual({ ok: false });
  });
});

describe("unparsable storage file (BEH-016)", () => {
  // @covers todo-cli:BEH-016
  it.each(UNPARSABLE)("reports %s as not ok and leaves the bytes unchanged", (_n, content) => {
    const p = join(dir(), "s.json");
    writeFileSync(p, content);
    expect(readTaskList(p)).toEqual({ ok: false });
    expect(readFileSync(p, "utf8")).toBe(content);
  });

  it("reads a valid empty storage file as an empty list", () => {
    const p = join(dir(), "s.json");
    writeFileSync(p, '{"nextId":1,"tasks":[]}');
    expect(readTaskList(p)).toEqual({ ok: true, value: { nextId: 1, tasks: [] } });
  });
});

describe("storage file of another shape (BEH-017)", () => {
  // @covers todo-cli:BEH-017
  it.each(FOREIGN)("reports %s as not ok and leaves the bytes unchanged", (_n, content) => {
    const p = join(dir(), "s.json");
    writeFileSync(p, content);
    expect(readTaskList(p)).toEqual({ ok: false });
    expect(readFileSync(p, "utf8")).toBe(content);
  });

  it("reads the contract shape with no tasks as an empty list", () => {
    const p = join(dir(), "s.json");
    writeFileSync(p, tl(1, []));
    expect(readTaskList(p)).toEqual({ ok: true, value: { nextId: 1, tasks: [] } });
  });
});

describe("missing storage file (BEH-018)", () => {
  // @covers todo-cli:BEH-018
  it("reads an absent file as an empty list and does not create it", () => {
    const d = dir();
    const p = join(d, "s.json");
    expect(readTaskList(p)).toEqual({ ok: true, value: { nextId: 1, tasks: [] } });
    expect(existsSync(p)).toBe(false);
  });

  it("keeps an absent file absent in an existing nested directory", () => {
    const d = dir();
    mkdirSync(join(d, "sub"));
    const p = join(d, "sub", "s.json");
    expect(readTaskList(p)).toEqual({ ok: true, value: { nextId: 1, tasks: [] } });
    expect(existsSync(p)).toBe(false);
  });
});

describe("first write (BEH-019)", () => {
  // @covers todo-cli:BEH-019
  it("creates the absent file holding exactly one task with id 1 and nextId 2", () => {
    const p = join(dir(), "s.json");
    expect(existsSync(p)).toBe(false);
    const first = { id: 1, text: "first", done: false, createdAt: TS };
    expect(writeTaskList(p, { nextId: 2, tasks: [first] })).toEqual({ ok: true, value: null });
    expect(existsSync(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ nextId: 2, tasks: [first] });
  });

  it("reports a write into a missing parent directory as not ok and creates nothing", () => {
    const d = dir();
    const p = join(d, "nope", "s.json");
    expect(writeTaskList(p, list(2, [task(1)]))).toEqual({ ok: false });
    expect(existsSync(p)).toBe(false);
    expect(existsSync(join(d, "nope"))).toBe(false);
  });
});

describe("task ids (INV-001, INV-002)", () => {
  // @covers todo-cli:INV-001
  it("keeps ten tasks with ids 1 to 10, each at least 1 and appearing once, through write and read", () => {
    const p = join(dir(), "s.json");
    const tasks = Array.from({ length: 10 }, (_, i) => task(i + 1));
    expect(writeTaskList(p, list(11, tasks))).toEqual({ ok: true, value: null });
    const r = readTaskList(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tasks.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it("rejects two tasks with id 1 in one file", () => {
    const p = join(dir(), "s.json");
    writeFileSync(p, tl(2, [task(1, "a"), task(1, "b")]));
    expect(readTaskList(p)).toEqual({ ok: false });
  });

  // @covers todo-cli:INV-002
  it("preserves nextId across a removal of the highest id and of every task", () => {
    const p = join(dir(), "s.json");
    expect(writeTaskList(p, list(3, [task(1)]))).toEqual({ ok: true, value: null });
    expect(readTaskList(p)).toEqual({ ok: true, value: list(3, [task(1)]) });
    expect(writeTaskList(p, list(3, []))).toEqual({ ok: true, value: null });
    expect(JSON.parse(readFileSync(p, "utf8")).nextId).toBe(3);
    expect(readTaskList(p)).toEqual({ ok: true, value: { nextId: 3, tasks: [] } });
  });
});

describe("task fields (INV-003)", () => {
  // @covers todo-cli:INV-003
  it("writes every task with id, text, done and createdAt of the contract types", () => {
    const p = join(dir(), "s.json");
    const now = formatCreatedAt(new Date("2026-10-31T10:20:34.541Z"));
    expect(now).toMatch(TS_RE);
    expect(writeTaskList(p, list(3, [task(1, "buy milk"), task(2, "x", true)]))).toEqual({ ok: true, value: null });
    const raw = JSON.parse(readFileSync(p, "utf8"));
    expect(raw.tasks).toHaveLength(2);
    for (const t of raw.tasks) {
      expect(Object.keys(t).sort()).toEqual(["createdAt", "done", "id", "text"]);
      expect(Number.isInteger(t.id) && t.id >= 1).toBe(true);
      expect(typeof t.text === "string" && t.text.length > 0).toBe(true);
      expect(typeof t.done).toBe("boolean");
      expect(t.createdAt).toMatch(TS_RE);
    }
    expect(raw.tasks[1].done).toBe(true);
    expect(raw.tasks[0].createdAt).toBe(TS);
  });
});

describe("failing invocations (INV-006, POL-003)", () => {
  // @covers todo-cli:INV-006
  it("leaves an unparsable file byte-identical and an absent target absent when a store call fails", () => {
    const d = dir();
    const p = join(d, "s.json");
    writeFileSync(p, "{oops");
    expect(readTaskList(p)).toEqual({ ok: false });
    expect(readFileSync(p, "utf8")).toBe("{oops");
    const q = join(d, "missing", "s.json");
    expect(writeTaskList(q, list(2, [task(1)]))).toEqual({ ok: false });
    expect(existsSync(q)).toBe(false);
  });

  it("reports a write onto a directory as not ok and leaves the directory in place", () => {
    const d = dir();
    const p = join(d, "adir");
    mkdirSync(p);
    expect(writeTaskList(p, list(2, [task(1)]))).toEqual({ ok: false });
    expect(statSync(p).isDirectory()).toBe(true);
  });

  // @covers todo-cli:POL-003
  it.each([...UNPARSABLE, ...FOREIGN.slice(0, 3)])(
    "reports %s as not ok, never as an empty list, and never modifies it",
    (_n, content) => {
      const p = join(dir(), "s.json");
      writeFileSync(p, content);
      const r = readTaskList(p);
      expect(r).toEqual({ ok: false });
      expect(readFileSync(p, "utf8")).toBe(content);
    },
  );
});

describe("read-only access (INV-007)", () => {
  // @covers todo-cli:INV-007
  it("never creates an absent file and never touches an existing one on read; a write changes it", () => {
    const d = dir();
    const absent = join(d, "a.json");
    expect(readTaskList(absent)).toEqual({ ok: true, value: { nextId: 1, tasks: [] } });
    expect(existsSync(absent)).toBe(false);

    const p = join(d, "s.json");
    const content = tl(3, [task(1), task(2)]);
    writeFileSync(p, content);
    const old = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(p, old, old);
    const before = statSync(p).mtimeMs;
    expect(readTaskList(p).ok).toBe(true);
    expect(readFileSync(p, "utf8")).toBe(content);
    expect(statSync(p).mtimeMs).toBe(before);

    expect(writeTaskList(p, list(4, [task(1), task(2), task(3, "c")]))).toEqual({ ok: true, value: null });
    expect(readFileSync(p, "utf8")).not.toBe(content);
    expect(JSON.parse(readFileSync(p, "utf8")).tasks).toHaveLength(3);
  });
});
