import { describe, expect, it } from "vitest";
import { runAdd, runDone, runList, runRm } from "../../src/commands/index.js";
import type { CommandOutcome } from "../../src/commands/index.js";
import type { Task, TaskList } from "../../src/store/index.js";

const TS = "2026-10-31T10:00:00.000Z";
const NOW = "2026-10-31T10:20:34.541Z";
const clock = (): Date => new Date(NOW);

function task(id: number, text: string, done = false): Task {
  return { id, text, done, createdAt: TS };
}
function store(nextId: number, tasks: Task[]): TaskList {
  return { nextId, tasks };
}
function threeTasks(): TaskList {
  return store(4, [task(1, "a"), task(2, "b", true), task(3, "c")]);
}
function success(outcome: CommandOutcome): { lines: readonly string[]; list: TaskList | null } {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error("expected ok outcome");
  return { lines: outcome.lines, list: outcome.list };
}
function failure(outcome: CommandOutcome): { code: string; line: string } {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("expected failed outcome");
  return outcome.error;
}
function ids(lines: readonly string[]): number[] {
  return lines.map((l) => Number(/#(\d+)/.exec(l)?.[1]));
}

describe("add command", () => {
  // @covers todo-cli:BEH-001
  it("add on an empty task list prints `#1 buy milk` and stores one open task with id 1", () => {
    const r = success(runAdd(store(1, []), "buy milk", clock));
    expect(r.lines).toEqual(["#1 buy milk"]);
    expect(r.list).toEqual({ nextId: 2, tasks: [{ id: 1, text: "buy milk", done: false, createdAt: NOW }] });
  });

  it("add takes the id from nextId, not from the highest remaining id", () => {
    const r = success(runAdd(store(5, [task(1, "a")]), "milk", clock));
    expect(r.lines).toEqual(["#5 milk"]);
    expect(r.list?.nextId).toBe(6);
    expect(r.list?.tasks.map((t) => t.id)).toEqual([1, 5]);
  });

  // @covers todo-cli:BEH-002
  it("add of non-blank text on a two-task list prints `#3 x` and stores a third task", () => {
    const r = success(runAdd(store(3, [task(1, "a"), task(2, "b")]), "x", clock));
    expect(r.lines).toEqual(["#3 x"]);
    expect(r.list?.tasks).toHaveLength(3);
    expect(r.list?.tasks[2]).toEqual({ id: 3, text: "x", done: false, createdAt: NOW });
  });

  // @covers todo-cli:BEH-003
  it("add of a several-word text prints it whole and stores it whole", () => {
    const r = success(runAdd(store(1, []), "buy milk today", clock));
    expect(r.lines).toEqual(["#1 buy milk today"]);
    expect(r.list?.tasks[0]?.text).toBe("buy milk today");
  });

  it("add of a one-word text prints `#1 milk`", () => {
    const r = success(runAdd(store(1, []), "milk", clock));
    expect(r.lines).toEqual(["#1 milk"]);
    expect(r.list?.tasks[0]?.text).toBe("milk");
  });

  // @covers todo-cli:CTR-001
  it("add prints exactly one line and stores id, text, done false and the createdAt of the clock", () => {
    const r = success(runAdd(store(1, []), "milk", clock));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/^#\d+ milk$/);
    expect(r.list?.tasks).toEqual([{ id: 1, text: "milk", done: false, createdAt: NOW }]);
  });

  it("add leaves the existing tasks unchanged", () => {
    const before = store(3, [task(1, "a"), task(2, "b", true)]);
    const r = success(runAdd(before, "x", clock));
    expect(r.list?.tasks.slice(0, 2)).toEqual([task(1, "a"), task(2, "b", true)]);
  });
});

describe("list command", () => {
  // @covers todo-cli:BEH-004
  it("list prints the open tasks `#1 a` then `#3 c` and omits the completed task", () => {
    const r = success(runList(threeTasks(), false));
    expect(r.lines).toEqual(["#1 a", "#3 c"]);
  });

  it("list does not request a write", () => {
    expect(success(runList(threeTasks(), false)).list).toBeNull();
    expect(success(runList(threeTasks(), true)).list).toBeNull();
  });

  it("list omits a completed task whose id is lower than an open task", () => {
    const r = success(runList(store(3, [task(1, "a", true), task(2, "b")]), false));
    expect(r.lines).toEqual(["#2 b"]);
  });

  // @covers todo-cli:BEH-005
  it("list --all prints `#1 a`, `[x] #2 b`, `#3 c` interleaved by id", () => {
    const r = success(runList(threeTasks(), true));
    expect(r.lines).toEqual(["#1 a", "[x] #2 b", "#3 c"]);
  });

  it("list --all on only open tasks prints the plain line", () => {
    const r = success(runList(store(2, [task(1, "a")]), true));
    expect(r.lines).toEqual(["#1 a"]);
  });

  it("list --all on only a completed task prints `[x] #1 a`", () => {
    const r = success(runList(store(2, [task(1, "a", true)]), true));
    expect(r.lines).toEqual(["[x] #1 a"]);
  });

  // @covers todo-cli:BEH-006
  it.each([
    ["an empty task list", store(1, [])],
    ["only completed tasks", store(2, [task(1, "b", true)])],
  ])("list without --all on %s prints no line", (_name, list) => {
    const r = success(runList(list, false));
    expect(r.lines).toEqual([]);
    expect(r.list).toBeNull();
  });

  it("list --all on one completed task prints one line", () => {
    const r = success(runList(store(2, [task(1, "b", true)]), true));
    expect(r.lines).toEqual(["[x] #1 b"]);
  });

  it("list --all on an empty task list prints no line", () => {
    expect(success(runList(store(1, []), true)).lines).toEqual([]);
  });

  // @covers todo-cli:CTR-002
  it("list prints open tasks as `#<id> <text>` and --all prints completed ones as `[x] #<id> <text>`", () => {
    const completed = store(3, [task(1, "a", true), task(2, "b", true)]);
    expect(success(runList(completed, true)).lines).toEqual(["[x] #1 a", "[x] #2 b"]);
    expect(success(runList(completed, false)).lines).toEqual([]);
    expect(success(runList(threeTasks(), false)).lines).toEqual(["#1 a", "#3 c"]);
  });

  // @covers todo-cli:INV-004
  it("list prints ids in numeric ascending order for ids 1, 10, 100", () => {
    const list = store(101, [task(1, "a"), task(10, "b"), task(100, "c")]);
    const r = success(runList(list, false));
    expect(r.lines).toEqual(["#1 a", "#10 b", "#100 c"]);
  });

  it.each([false, true])("list prints ascending ids for storage order 3, 1, 2 (all=%s)", (all) => {
    const list = store(4, [task(3, "c"), task(1, "a"), task(2, "b")]);
    const r = success(runList(list, all));
    expect(ids(r.lines)).toEqual([1, 2, 3]);
    expect(r.lines).toHaveLength(3);
  });

  it("list --all prints no header, blank or footer line", () => {
    const r = success(runList(threeTasks(), true));
    expect(r.lines.every((l) => /^(\[x\] )?#\d+ \S/.test(l))).toBe(true);
  });
});

describe("done command", () => {
  const open2 = (): TaskList => store(3, [task(1, "a"), task(2, "b")]);

  // @covers todo-cli:BEH-007
  it("done 2 prints `#2 done`, marks task 2 done and leaves task 1 open", () => {
    const r = success(runDone(open2(), "2"));
    expect(r.lines).toEqual(["#2 done"]);
    expect(r.list?.tasks).toEqual([task(1, "a"), task(2, "b", true)]);
    expect(r.list?.nextId).toBe(3);
  });

  it("done on the lowest id prints `#1 done` and marks it done", () => {
    const r = success(runDone(store(2, [task(1, "a")]), "1"));
    expect(r.lines).toEqual(["#1 done"]);
    expect(r.list?.tasks[0]?.done).toBe(true);
  });

  it("done on an empty task list fails with E_NO_TASK", () => {
    expect(failure(runDone(store(1, []), "1"))).toMatchObject({ code: "E_NO_TASK", line: "error: no task #1" });
  });

  it("done 99 fails with E_NO_TASK and no task line", () => {
    const o = runDone(open2(), "99");
    expect(failure(o)).toMatchObject({ code: "E_NO_TASK", line: "error: no task #99" });
    expect(o).not.toHaveProperty("lines");
  });

  // @covers todo-cli:BEH-008
  it("done on a completed task prints `#2 done` and keeps done true", () => {
    const r = success(runDone(store(3, [task(1, "a"), task(2, "b", true)]), "2"));
    expect(r.lines).toEqual(["#2 done"]);
    expect(r.list?.tasks).toEqual([task(1, "a"), task(2, "b", true)]);
  });

  it("done twice in a row gives the same line both times", () => {
    const first = success(runDone(open2(), "2"));
    const second = success(runDone(first.list as TaskList, "2"));
    expect(first.lines).toEqual(["#2 done"]);
    expect(second.lines).toEqual(["#2 done"]);
    expect(second.list?.tasks[1]?.done).toBe(true);
  });

  it("done 42 on a store without task 42 fails with E_NO_TASK", () => {
    expect(failure(runDone(open2(), "42"))).toMatchObject({ code: "E_NO_TASK", line: "error: no task #42" });
  });

  // @covers todo-cli:BEH-009
  it("done 7 on a store with ids 1 and 2 fails with E_NO_TASK and `error: no task #7`", () => {
    const o = runDone(open2(), "7");
    expect(failure(o)).toEqual({ code: "E_NO_TASK", line: "error: no task #7" });
    expect(o).not.toHaveProperty("list");
  });

  it("done on an id removed earlier fails with E_NO_TASK", () => {
    const list = store(3, [task(1, "a")]);
    expect(failure(runDone(list, "2"))).toEqual({ code: "E_NO_TASK", line: "error: no task #2" });
  });

  // @covers todo-cli:CTR-003
  it("done prints exactly `#<id> done` for an open and for a completed task", () => {
    const open = success(runDone(open2(), "2"));
    expect(open.lines).toEqual(["#2 done"]);
    expect(open.list?.tasks.find((t) => t.id === 2)?.done).toBe(true);
    const completed = success(runDone(store(3, [task(1, "a", true), task(2, "b", true)]), "2"));
    expect(completed.lines).toEqual(["#2 done"]);
  });

  it("done on an unknown id fails with E_NO_TASK and `error: no task #42`", () => {
    expect(failure(runDone(store(2, [task(1, "a")]), "42"))).toEqual({
      code: "E_NO_TASK",
      line: "error: no task #42",
    });
  });
});

describe("rm command", () => {
  const two = (): TaskList => store(3, [task(1, "a"), task(2, "b")]);

  // @covers todo-cli:BEH-010
  it("rm 1 prints `#1 removed` and keeps only task 2 with id 2", () => {
    const r = success(runRm(two(), "1"));
    expect(r.lines).toEqual(["#1 removed"]);
    expect(r.list?.tasks).toEqual([task(2, "b")]);
  });

  it("rm of the last remaining task leaves zero tasks and nextId 2", () => {
    const r = success(runRm(store(2, [task(1, "a")]), "1"));
    expect(r.lines).toEqual(["#1 removed"]);
    expect(r.list).toEqual({ nextId: 2, tasks: [] });
  });

  it("a list after rm 1 does not print task 1", () => {
    const r = success(runRm(two(), "1"));
    expect(success(runList(r.list as TaskList, false)).lines).toEqual(["#2 b"]);
  });

  it("rm 1 twice in a row fails the second time with E_NO_TASK", () => {
    const first = success(runRm(two(), "1"));
    expect(first.lines).toEqual(["#1 removed"]);
    expect(failure(runRm(first.list as TaskList, "1"))).toMatchObject({ code: "E_NO_TASK" });
  });

  it("rm on an empty task list fails with E_NO_TASK", () => {
    expect(failure(runRm(store(1, []), "1"))).toEqual({ code: "E_NO_TASK", line: "error: no task #1" });
  });

  // @covers todo-cli:BEH-011
  it("rm 5 on a store with ids 1 and 2 fails with E_NO_TASK and `error: no task #5`", () => {
    const o = runRm(two(), "5");
    expect(failure(o)).toEqual({ code: "E_NO_TASK", line: "error: no task #5" });
    expect(o).not.toHaveProperty("list");
    expect(o).not.toHaveProperty("lines");
  });

  it("rm on an id removed earlier fails with E_NO_TASK", () => {
    expect(failure(runRm(store(3, [task(1, "a")]), "2"))).toEqual({
      code: "E_NO_TASK",
      line: "error: no task #2",
    });
  });

  // @covers todo-cli:CTR-004
  it("rm 2 prints `#2 removed`, keeps task 1 with id 1 and keeps nextId 3", () => {
    const r = success(runRm(two(), "2"));
    expect(r.lines).toEqual(["#2 removed"]);
    expect(r.list).toEqual({ nextId: 3, tasks: [task(1, "a")] });
  });

  it("rm on an unknown id fails with E_NO_TASK and `error: no task #5`", () => {
    expect(failure(runRm(store(2, [task(1, "a")]), "5"))).toEqual({
      code: "E_NO_TASK",
      line: "error: no task #5",
    });
  });

  it("add after rm hands out an id above every id ever used", () => {
    const removed = success(runRm(two(), "2"));
    const added = success(runAdd(removed.list as TaskList, "n", clock));
    expect(added.lines).toEqual(["#3 n"]);
  });
});
