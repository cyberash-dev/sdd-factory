import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderList, runHelp, runList, usageText } from "../../src/read-commands/index.js";

const T = "2026-01-01T00:00:00.000Z";
const task = (id: number, text: string, done: boolean) => ({ id, text, done, createdAt: T });

function storage(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "todo-read-"));
  const path = join(dir, "todo.json");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

const mixed = () =>
  JSON.stringify([task(1, "alpha", false), task(2, "beta", true), task(3, "gamma", false)]);

function stdoutOf(result: ReturnType<typeof runList>): string {
  expect(result.ok).toBe(true);
  return result.ok ? result.stdout : "";
}

describe("list of open Tasks", () => {
  // @covers todo-cli:BEH-005
  it("prints open Tasks only, ascending id, one line each", () => {
    const path = storage(mixed());
    expect(stdoutOf(runList(path, false))).toBe("#1 alpha\n#3 gamma\n");
  });

  it("prints a single open Task and hides the completed one", () => {
    const path = storage(JSON.stringify([task(1, "alpha", false), task(2, "beta", true)]));
    expect(stdoutOf(runList(path, false))).toBe("#1 alpha\n");
  });

  it("prints several open Tasks in ascending id order", () => {
    const path = storage(
      JSON.stringify([task(1, "alpha", false), task(2, "beta", false), task(3, "gamma", false)]),
    );
    expect(stdoutOf(runList(path, false))).toBe("#1 alpha\n#2 beta\n#3 gamma\n");
  });

  it("renderList orders open Tasks ascending even when stored out of order", () => {
    const tasks = [task(3, "gamma", false), task(1, "alpha", false), task(2, "beta", true)];
    expect(renderList(tasks, false)).toBe("#1 alpha\n#3 gamma\n");
  });
});

describe("list --all", () => {
  // @covers todo-cli:BEH-006
  it("prints a completed Task with the highest id with an [x] prefix", () => {
    const path = storage(JSON.stringify([task(1, "alpha", false), task(2, "beta", true)]));
    expect(stdoutOf(runList(path, true))).toBe("#1 alpha\n[x] #2 beta\n");
  });

  it("keeps a completed Task with the lowest id first", () => {
    const path = storage(JSON.stringify([task(1, "alpha", true), task(2, "beta", false)]));
    expect(stdoutOf(runList(path, true))).toBe("[x] #1 alpha\n#2 beta\n");
  });

  it("prints no [x] prefix when no Task is completed", () => {
    const path = storage(JSON.stringify([task(1, "alpha", false), task(2, "beta", false)]));
    const out = stdoutOf(runList(path, true));
    expect(out).toBe("#1 alpha\n#2 beta\n");
    expect(out).not.toContain("[x]");
  });

  it("renderList with all merges completed Tasks into one ascending id order", () => {
    const tasks = [task(3, "gamma", false), task(2, "beta", true), task(1, "alpha", false)];
    expect(renderList(tasks, true)).toBe("#1 alpha\n[x] #2 beta\n#3 gamma\n");
  });

  it.each([
    ["empty list", "[]"],
    ["missing file", undefined],
  ])("prints nothing for %s", (_name, content) => {
    const path = storage(content);
    expect(stdoutOf(runList(path, true))).toBe("");
  });
});

describe("list with nothing to show", () => {
  // @covers todo-cli:BEH-007
  it("writes no bytes and does not create the storage file when it is missing", () => {
    const path = storage();
    expect(runList(path, false)).toEqual({ ok: true, stdout: "" });
    expect(existsSync(path)).toBe(false);
  });

  it("writes no bytes for an empty list", () => {
    const path = storage("[]");
    expect(runList(path, false)).toEqual({ ok: true, stdout: "" });
  });

  it("writes no bytes when only completed Tasks are stored", () => {
    const content = JSON.stringify([task(1, "alpha", true), task(2, "beta", true)]);
    const path = storage(content);
    expect(runList(path, false)).toEqual({ ok: true, stdout: "" });
    expect(readFileSync(path, "utf8")).toBe(content);
  });

  it("prints exactly one line for one open Task", () => {
    const path = storage(JSON.stringify([task(1, "alpha", false)]));
    expect(runList(path, false)).toEqual({ ok: true, stdout: "#1 alpha\n" });
  });

  it("renderList returns the empty string when nothing is shown", () => {
    expect(renderList([], false)).toBe("");
    expect(renderList([task(1, "alpha", true)], false)).toBe("");
  });
});

describe("list storage failure", () => {
  // @covers todo-cli:CTR-002
  it.each([false, true])("reports E_STORAGE with exit 1 for unreadable storage (all=%s)", (all) => {
    const path = storage("not-json");
    const result = runList(path, all);
    expect(result).toEqual({
      ok: false,
      error: { code: "E_STORAGE", exitCode: 1, message: `error: cannot read ${path}` },
    });
    expect(readFileSync(path, "utf8")).toBe("not-json");
  });

  it("reports E_STORAGE for content that is not a Task array", () => {
    const path = storage('{"id":1}');
    const result = runList(path, false);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("E_STORAGE");
  });
});

describe("--help usage text", () => {
  const tokens = ["add", "list", "done", "rm", "--help"];

  // @covers todo-cli:CTR-005
  it("succeeds with a usage text containing every command token", () => {
    const result = runHelp();
    expect(result.ok).toBe(true);
    const out = result.ok ? result.stdout : "";
    for (const token of tokens) expect(out).toContain(token);
  });

  // @covers todo-cli:BEH-016
  it("succeeds without touching an unreadable storage file", () => {
    const path = storage("not-json-at-all");
    const result = runHelp();
    expect(result.ok).toBe(true);
    const out = result.ok ? result.stdout : "";
    for (const token of tokens) expect(out).toContain(token);
    expect(readFileSync(path, "utf8")).toBe("not-json-at-all");
  });

  it("usageText names every command token and matches the runHelp output", () => {
    const text = usageText();
    for (const token of tokens) expect(text).toContain(token);
    expect(runHelp()).toEqual({ ok: true, stdout: text });
  });
});
