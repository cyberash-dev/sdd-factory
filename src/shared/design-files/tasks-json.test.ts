import { describe, expect, it } from "vitest";
import { parseTasksJson, tasksJsonSyntaxError, tasksJsonTaskData, TasksJsonParseError } from "./tasks-json.js";

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "T-001",
    title: "parse CLI arguments",
    covers: ["todo-cli:CTR-001"],
    writes: ["src/cli/**", "tests/cli/**"],
    dependsOn: [],
    designRefs: ["M-01"],
    testBudget: { maxTests: 12 },
    reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" },
    ...overrides,
  };
}

function file(tasks: readonly Record<string, unknown>[], root: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, partition: "todo-cli", tasks, ...root });
}

describe("parseTasksJson", () => {
  // @covers design-stage:CTR-003
  it("parses a valid file into typed tasks", () => {
    const parsed = parseTasksJson(file([task(), task({ id: "T-002", dependsOn: ["T-001"], writes: ["src/store/**", "tests/store/**"] })]));

    expect(parsed).toEqual({
      schemaVersion: 1,
      partition: "todo-cli",
      tasks: [
        { id: "T-001", title: "parse CLI arguments", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"], dependsOn: [], designRefs: ["M-01"], testBudget: { maxTests: 12 }, reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" } },
        { id: "T-002", title: "parse CLI arguments", covers: ["todo-cli:CTR-001"], writes: ["src/store/**", "tests/store/**"], dependsOn: ["T-001"], designRefs: ["M-01"], testBudget: { maxTests: 12 }, reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" } },
      ],
    });
  });

  it.each([
    ["invalid JSON", "{not json", "invalid JSON"],
    ["schemaVersion 2", file([task()], { schemaVersion: 2 }), "root: field schemaVersion must be 1"],
    ["empty tasks", file([]), "root: field tasks must be a non-empty array"],
    ["unknown root key", file([task()], { extra: 1 }), "root: unknown field extra"],
    ["bad task id", file([task({ id: "T-1" })]), "tasks[0]: field id must match T-NNN"],
    ["writes not strings", file([task({ writes: ["src/**", 3] })]), "task T-001: field writes must be an array of strings"],
    ["missing dependsOn", file([task({ dependsOn: undefined })]), "task T-001: field dependsOn must be an array of strings"],
    ["zero test budget", file([task({ testBudget: { maxTests: 0 } })]), "task T-001: field testBudget.maxTests must be a positive integer"],
    ["wrong rework route", file([task({ reworkRoute: { onImplementationFailure: "planner", onTestContractConflict: "reviewer" } })]), "task T-001: field reworkRoute must be"],
    ["unknown task key", file([task({ owner: "x" })]), "task T-001: unknown field owner"],
    ["duplicate id", file([task(), task()]), "task T-001: duplicate id"],
  ])("rejects %s naming the offending field", (_label, text, message) => {
    expect(() => parseTasksJson(text)).toThrow(TasksJsonParseError);
    expect(() => parseTasksJson(text)).toThrow(message);
  });
});

describe("tasksJsonTaskData", () => {
  // @covers design-stage:DLT-005
  it("maps each task id to the JSON of its task object", () => {
    const data = tasksJsonTaskData('{"schemaVersion": 1, "tasks": [{"id": "T-001", "title": "a"}]}');

    expect([...data.entries()]).toEqual([["T-001", '{"id":"T-001","title":"a"}']]);
  });

  // @covers design-stage:DLT-005
  it("yields no tasks for text that is not JSON", () => {
    const data = tasksJsonTaskData('{"tasks": [{"id": "T-001"}],}');

    expect(data.size).toBe(0);
  });
});

describe("tasksJsonSyntaxError", () => {
  // @covers design-stage:DLT-005
  it("names invalid JSON for a trailing comma", () => {
    expect(tasksJsonSyntaxError('{"tasks": [],}')).toMatch(/^invalid JSON: /);
  });

  // @covers design-stage:DLT-005
  it("is null for JSON that breaks the schema", () => {
    expect(tasksJsonSyntaxError('{"unknown": true}')).toBeNull();
  });
});
