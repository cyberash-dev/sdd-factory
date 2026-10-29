import { describe, expect, it } from "vitest";
import type { EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../bus/domain/envelope.js";
import { createRunState, createTaskState, type RunState } from "../../bus/domain/run-state.js";
import { reduce } from "../../bus/domain/transition.js";
import { DEFAULT_CONFIG } from "../../shared/config.js";
import { createDesignRules } from "./rules.js";

const RUN_ID = "todo-cli-20261029-120000";
const rules = createDesignRules({ caps: DEFAULT_CONFIG.caps, worktreesDir: "/run/worktrees" });

function delivered(type: EventType, payload: EventPayload): DeliveredEvent<EventType> {
  return { type, runId: RUN_ID, occurredAt: "2026-10-29T12:00:01.000Z", producer: "foreman", payload, seq: 7 };
}

function stateIn(status: RunState["status"], overrides: Partial<RunState> = {}): RunState {
  const base = createRunState({ runId: RUN_ID, slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
  return { ...base, status, ...overrides };
}

function apply(state: RunState, type: EventType, payload: EventPayload) {
  const outcome = reduce(rules, state, delivered(type, payload), new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

const taskSummaries = [
  { id: "T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"], dependsOn: [] },
  { id: "T-002", covers: ["todo-cli:CTR-002"], writes: ["src/store/**", "tests/store/**"], dependsOn: ["T-001"] },
];

describe("planner barrier", () => {
  // @covers design-stage:BEH-002
  it("starts no planner when only design.tech.ready arrived", () => {
    const result = apply(stateIn("designing"), "design.tech.ready", { path: "design/tech.md" });

    expect([result.state.status, result.state.design, result.effects]).toEqual(["designing", { techReady: true, verificationReady: false, tasksPath: null }, []]);
  });

  it("starts no planner when only design.verification.ready arrived", () => {
    const result = apply(stateIn("designing"), "design.verification.ready", { path: "design/verification.md" });

    expect([result.state.status, result.state.design.verificationReady, result.effects]).toEqual(["designing", true, []]);
  });

  // @covers design-stage:BEH-002
  it("starts exactly one planner when the second ready event completes the barrier", () => {
    const afterTech = apply(stateIn("designing"), "design.tech.ready", { path: "design/tech.md" });

    const result = apply(afterTech.state, "design.verification.ready", { path: "design/verification.md" });

    expect([result.state.status, result.effects]).toEqual(["planning", [{ kind: "design.plan", attempt: 1, reworkFinding: "" }]]);
  });

  it("completes the barrier in either order", () => {
    const afterVerification = apply(stateIn("designing"), "design.verification.ready", { path: "design/verification.md" });

    const result = apply(afterVerification.state, "design.tech.ready", { path: "design/tech.md" });

    expect([result.state.status, result.effects.map((effect) => effect.kind)]).toEqual(["planning", ["design.plan"]]);
  });

  it("ignores design.tasks.ready before the barrier as out of order", () => {
    const outcome = reduce(rules, stateIn("designing"), delivered("design.tasks.ready", { path: "design/tasks.json", taskCount: 2, tasks: taskSummaries }), new Set());

    expect(outcome.kind).toBe("out_of_order_ignored");
  });

  it("records the role usage from the ready event into the cost ledger", () => {
    const usage = { model: "m", costUsd: 0.5, inputTokens: 100, outputTokens: 20, durationMs: 900 };

    const result = apply(stateIn("designing"), "design.tech.ready", { path: "design/tech.md", usage, handoffReruns: 1 });

    expect([result.state.costLedger.totalUsd, result.state.costLedger.entries[0]?.participant, result.state.stageHandoffReruns]).toEqual([0.5, "architect", { architect: 1 }]);
  });
});

describe("design.tasks.ready", () => {
  // @covers design-stage:BEH-002
  it("moves to building, creates one task state per task and schedules the build", () => {
    const result = apply(stateIn("planning"), "design.tasks.ready", { path: "design/tasks.json", taskCount: 2, tasks: taskSummaries });

    expect([result.state.status, result.state.design.tasksPath, result.state.tasks, result.effects]).toEqual([
      "building",
      "design/tasks.json",
      {
        "T-001": createTaskState({ worktree: "/run/worktrees/T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"], dependsOn: [] }),
        "T-002": createTaskState({ worktree: "/run/worktrees/T-002", covers: ["todo-cli:CTR-002"], writes: ["src/store/**", "tests/store/**"], dependsOn: ["T-001"] }),
      },
      [{ kind: "build.schedule", tasksPath: "design/tasks.json" }],
    ]);
  });

  it("throws when the payload carries no task summaries", () => {
    expect(() => apply(stateIn("planning"), "design.tasks.ready", { path: "design/tasks.json", taskCount: 1 })).toThrow("payload.tasks");
  });

  // @covers design-stage:BEH-004
  it("on a re-cut during build keeps unchanged tasks, reworks only changed ones and drops merged-away ids", () => {
    const approved = { ...createTaskState({ worktree: "/run/worktrees/T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"], dependsOn: [] }), status: "approved" as const };
    const pending = { ...createTaskState({ worktree: "/run/worktrees/T-002", covers: ["todo-cli:CTR-002"], writes: ["src/store/**", "tests/store/**"], dependsOn: [] }), status: "impl_pending" as const, attempts: { implementer: 1, testWriter: 1 } };
    const gone = createTaskState({ worktree: "/run/worktrees/T-003", covers: ["todo-cli:CTR-003"], writes: ["src/report/**", "tests/report/**"], dependsOn: [] });
    const state = stateIn("building", { tasks: { "T-001": approved, "T-002": pending, "T-003": gone } });
    const recut = [taskSummaries[0], { id: "T-002", covers: ["todo-cli:CTR-002", "todo-cli:CTR-003"], writes: ["src/store/**", "src/report/**", "tests/store/**"], dependsOn: [] }];

    const result = apply(state, "design.tasks.ready", { path: "design/tasks.json", taskCount: 2, tasks: recut, changedTaskIds: ["T-002"] });

    expect([result.state.status, Object.keys(result.state.tasks), result.state.tasks["T-001"], result.state.tasks["T-002"]?.covers, result.state.tasks["T-002"]?.status, result.emits]).toEqual([
      "building",
      ["T-001", "T-002"],
      approved,
      ["todo-cli:CTR-002", "todo-cli:CTR-003"],
      "impl_pending",
      [{ type: "task.rework", producer: "foreman", payload: { taskId: "T-002", target: "test-writer", attempt: 2, reason: "planner_recut", findingPath: null } }],
    ]);
  });
});

describe("design.tech.ready after an architect repair", () => {
  // @covers design-stage:BEH-004
  it("reworks only the lanes whose covers intersect the repaired spec ids", () => {
    const cli = createTaskState({ worktree: "/w/T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-001"], writes: [], dependsOn: [] });
    const store = createTaskState({ worktree: "/w/T-002", covers: ["todo-cli:CTR-002"], writes: [], dependsOn: [] });
    const state = stateIn("building", { tasks: { "T-001": cli, "T-002": store } });

    const result = apply(state, "design.tech.ready", { path: "design/tech.md", specIds: ["todo-cli:BEH-001"] });

    expect([result.state.status, result.effects, result.emits]).toEqual([
      "building",
      [],
      [{ type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "test-writer", attempt: 1, reason: "architect_repair: todo-cli:BEH-001", findingPath: null } }],
    ]);
  });
});

describe("design.rework", () => {
  // @covers design-stage:BEH-002
  it("re-runs the planner once with the validator message as attempt 2", () => {
    const result = apply(stateIn("planning"), "design.rework", { target: "planner", reason: "overlapping_writes: T-001, T-002: src/cli/**", attempt: 1 });

    expect([result.state.status, result.state.stageAttempts.plannerRecuts, result.effects, result.emits]).toEqual([
      "planning",
      1,
      [{ kind: "design.plan", attempt: 2, reworkFinding: "overlapping_writes: T-001, T-002: src/cli/**" }],
      [],
    ]);
  });

  // @covers design-stage:CST-001
  it("blocks the design with planner_cap on the second planner failure", () => {
    const state = stateIn("planning", { stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 1, architectRepairs: 0, assemblyRounds: 0 } });

    const result = apply(state, "design.rework", { target: "planner", reason: "uncovered_id: todo-cli:BEH-003", attempt: 2 });

    expect([result.effects, result.emits, result.state.stageAttempts.plannerRecuts]).toEqual([[], [{ type: "design.blocked", producer: "foreman", payload: { reason: "planner_cap" } }], 1]);
  });

  // @covers design-stage:CST-001
  it("counts a TASK-OVERFLOW re-cut during build against the same planner cap", () => {
    const state = stateIn("building", { stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 1, architectRepairs: 0, assemblyRounds: 0 } });

    const result = apply(state, "design.rework", { target: "planner", reason: "TASK-OVERFLOW from T-002 naming src/report/x.ts", attempt: 2 });

    expect([result.state.status, result.emits.map((event) => event.type)]).toEqual(["building", ["design.blocked"]]);
  });

  // @covers design-stage:BEH-004
  it("re-runs the architect with the finding and increments the repair counter", () => {
    const result = apply(stateIn("designing"), "design.rework", { target: "architect", reason: "unpinned dependency: vitest@^5", attempt: 1 });

    expect([result.state.stageAttempts.architectRepairs, result.state.design.techReady, result.effects]).toEqual([1, false, [{ kind: "design.architect", attempt: 2, reworkFinding: "unpinned dependency: vitest@^5", specIds: [] }]]);
  });

  // @covers design-stage:CST-002
  it("fails the run with cap_exhausted on the second architect repair", () => {
    const state = stateIn("building", { stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 0, architectRepairs: 1, assemblyRounds: 0 } });

    const result = apply(state, "design.rework", { target: "architect", reason: "VD-INFEASIBLE todo-cli:NFR-001", attempt: 1, specIds: ["todo-cli:NFR-001"] });

    expect([result.state.status, result.state.stageAttempts.architectRepairs, result.effects, result.emits.map((event) => [event.type, event.payload["stage"], event.payload["reason"]])]).toEqual([
      "building",
      1,
      [],
      [["run.failed", "design", "cap_exhausted"]],
    ]);
  });
});

describe("design.blocked", () => {
  // @covers design-stage:BEH-001
  it("emits run.failed with design_blocked and leaves the terminal status to the factory rule", () => {
    const result = apply(stateIn("designing"), "design.blocked", { reason: "context_firewall_violation" });

    expect([result.state.status, result.state.failure, result.emits]).toEqual([
      "designing",
      null,
      [{ type: "run.failed", producer: "foreman", payload: { stage: "design", reason: "design_blocked", detail: "context_firewall_violation" } }],
    ]);
  });

  it("carries the block detail into run.failed when the event has one", () => {
    const result = apply(stateIn("designing"), "design.blocked", { reason: "tech_md_invalid", detail: "missing section: ## TD-TOOLING" });

    expect(result.emits.map((event) => event.payload["detail"])).toEqual(["missing section: ## TD-TOOLING"]);
  });

  it("is ignored once the run has already failed", () => {
    const outcome = reduce(rules, stateIn("failed"), delivered("design.blocked", { reason: "planner_cap" }), new Set());

    expect(outcome.kind).toBe("out_of_order_ignored");
  });
});
