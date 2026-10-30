import { describe, expect, it } from "vitest";
import { parseArgv, UsageError } from "./argv.js";

function usageMessage(argv: readonly string[]): string {
  try {
    parseArgv(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      return error.message;
    }
    throw error;
  }
  return "no error";
}

describe("factory argv", () => {
  // @covers factory:CTR-001
  it("parses the minimal run command with defaults", () => {
    expect(parseArgv(["run", "specs/todo.md"])).toEqual({ kind: "run", specPath: "specs/todo.md", operator: null, push: true, outDir: null, maxParallelLanes: null });
  });

  it("parses every run flag", () => {
    expect(parseArgv(["run", "--operator", "cyberash", "specs/todo.md", "--no-push", "--out", "out/todo", "--max-parallel-lanes", "2"])).toEqual({
      kind: "run",
      specPath: "specs/todo.md",
      operator: "cyberash",
      push: false,
      outDir: "out/todo",
      maxParallelLanes: 2,
    });
  });

  // @covers factory:DLT-004
  it("parses the minimal resume command with defaults", () => {
    expect(parseArgv(["resume", "todo-20261029-120000"])).toEqual({ kind: "resume", runId: "todo-20261029-120000", note: null, force: false, push: true, outDir: null, maxParallelLanes: null });
  });

  // @covers factory:DLT-004
  it("parses every resume flag", () => {
    expect(parseArgv(["resume", "todo-20261029-120000", "--note", "fixed the critic", "--force", "--no-push", "--out", "out/todo", "--max-parallel-lanes", "3"])).toEqual({
      kind: "resume",
      runId: "todo-20261029-120000",
      note: "fixed the critic",
      force: true,
      push: false,
      outDir: "out/todo",
      maxParallelLanes: 3,
    });
  });

  // @covers factory:DLT-011
  // @covers factory:CTR-001
  it("parses replay of an explicit event seq", () => {
    expect(parseArgv(["replay", "todo-20261029-120000", "--event", "42"])).toEqual({ kind: "replay", runId: "todo-20261029-120000", event: { kind: "seq", seq: 42 } });
  });

  // @covers factory:DLT-011
  // @covers factory:CTR-001
  it("parses replay of the event resume would redo first", () => {
    expect(parseArgv(["replay", "--last", "todo-20261029-120000"])).toEqual({ kind: "replay", runId: "todo-20261029-120000", event: { kind: "last" } });
  });

  it("parses the nudge command", () => {
    expect(parseArgv(["nudge", "todo-20261029-120000", "--note", "retry the planner"])).toEqual({ kind: "nudge", runId: "todo-20261029-120000", note: "retry the planner" });
  });

  it.each([
    [["run"], "missing <spec.md>"],
    [["run", "a.md", "--verbose"], "unknown flag --verbose"],
    [["run", "a.md", "b.md"], "unexpected positional argument b.md"],
    [["run", "a.md", "--max-parallel-lanes", "0"], "--max-parallel-lanes must be an integer between 1 and 8, got 0"],
    [["run", "a.md", "--max-parallel-lanes", "9"], "--max-parallel-lanes must be an integer between 1 and 8, got 9"],
    [["run", "a.md", "--operator"], "--operator requires a value"],
    [["nudge", "run-1"], "--note is required"],
    [["resume"], "missing <runId>"],
    [["resume", "run-1", "run-2"], "unexpected positional argument run-2"],
    [["resume", "run-1", "--note"], "--note requires a value"],
    [[], "missing subcommand"],
    [["build"], "unknown subcommand build"],
  ])("rejects %j with a usage error naming the problem", (argv, message) => {
    expect(usageMessage(argv)).toBe(message);
  });

  // @covers factory:DLT-011
  // @covers factory:CTR-001
  it.each([
    [["replay", "run-1"], "one of --event <seq> or --last is required"],
    [["replay", "run-1", "--event", "3", "--last"], "--event and --last are mutually exclusive"],
    [["replay", "run-1", "--last", "--event", "3"], "--event and --last are mutually exclusive"],
    [["replay", "run-1", "--event", "0"], "--event must be a positive integer seq, got 0"],
    [["replay", "run-1", "--event", "x"], "--event must be a positive integer seq, got x"],
    [["replay", "run-1", "--event"], "--event requires a value"],
    [["replay", "--last"], "missing <runId>"],
    [["replay", "run-1", "run-2", "--last"], "unexpected positional argument run-2"],
    [["replay", "run-1", "--last", "--force"], "unknown flag --force"],
  ])("rejects replay argv %j with a usage error naming the problem", (argv, message) => {
    expect(usageMessage(argv)).toBe(message);
  });
});
