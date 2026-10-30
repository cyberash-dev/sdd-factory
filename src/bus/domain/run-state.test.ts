import { describe, expect, it } from "vitest";
import { createRunState, createTaskState, simpleFixAttempts, stageOf, withSimpleFix, withCostEntry } from "./run-state.js";

describe("run state snapshot", () => {
  // @covers bus:CTR-008
  it("starts with schemaVersion 1, status started, zero counters and an empty ledger", () => {
    const state = createRunState({ runId: "todo-cli-20261029-120000", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });

    expect(state).toEqual({
      schemaVersion: 1,
      runId: "todo-cli-20261029-120000",
      slug: "todo-cli",
      operator: "cyberash",
      status: "started",
      startedAt: "2026-10-29T12:00:00.000Z",
      updatedAt: "2026-10-29T12:00:00.000Z",
      lastSeq: 0,
      stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 0, architectRepairs: 0, assemblyRounds: 0 },
      stageHandoffReruns: {},
      design: { techReady: false, verificationReady: false, tasksPath: null },
      assumptionsByRecord: {},
      tasks: {},
      costLedger: { entries: [], totalUsd: 0 },
      failure: null,
      simpleFixes: {},
    });
  });

  // @covers bus:DLT-005
  // @covers factory:CST-005
  it("counts simple fixes per owner and unit without sharing the counter between two tasks", () => {
    const state = createRunState({ runId: "todo-cli-20261029-120000", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });

    const next = withSimpleFix(withSimpleFix(state, "implementer", "T-001"), "implementer", "T-001");

    expect([simpleFixAttempts(next, "implementer", "T-001"), simpleFixAttempts(next, "implementer", "T-002"), next.simpleFixes]).toEqual([2, 0, { "implementer:T-001": 2 }]);
  });

  it("creates a task in status ready with zero attempts and the planner's covers, writes and dependencies", () => {
    const task = createTaskState({ worktree: "/wt/T-001", covers: ["todo-cli:BEH-001"], writes: ["src/cli/**", "tests/cli/**"], dependsOn: [] });

    expect(task).toEqual({
      status: "ready",
      attempts: { implementer: 0, testWriter: 0, critic: 0 },
      handoffReruns: {},
      baseSha: null,
      testsSha: null,
      implSha: null,
      worktree: "/wt/T-001",
      covers: ["todo-cli:BEH-001"],
      writes: ["src/cli/**", "tests/cli/**"],
      dependsOn: [],
      lastEvent: "design.tasks.ready",
    });
  });

  it("sums ledger entries treating a null cost as zero", () => {
    const ledger = withCostEntry(
      withCostEntry({ entries: [], totalUsd: 0 }, { participant: "architect", taskId: null, stage: "design", costUsd: 0.25, inputTokens: 10, outputTokens: 5, model: "m", durationMs: 1 }),
      { participant: "implementer", taskId: "T-001", stage: "build", costUsd: null, inputTokens: 1, outputTokens: 1, model: null, durationMs: 1 },
    );

    expect([ledger.entries.length, ledger.totalUsd]).toEqual([2, 0.25]);
  });

  it.each([
    ["started", "workspace"],
    ["spec_review", "spec"],
    ["planning", "design"],
    ["building", "build"],
    ["assembling", "assembly"],
    ["publishing", "publish"],
  ] as const)("maps status %s to stage %s", (status, stage) => {
    expect(stageOf(status, null)).toBe(stage);
  });

  it("reports the recorded failure stage once the run failed", () => {
    expect(stageOf("failed", { stage: "design", reason: "runtime_error", detail: "x" })).toBe("design");
  });
});
