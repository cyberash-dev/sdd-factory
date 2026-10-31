import { describe, expect, it } from "vitest";
import type { RunState, StageAttempts } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type PendingEvent, type ReduceOutcome, type TransitionRule } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG, type Caps } from "../../src/shared/config.js";
import { aTask, buildingState, delivered, TESTS_SHA } from "./support/state.js";

function rulesWith(caps: Partial<Caps>): readonly TransitionRule[] {
  return buildStageRules({ caps: { ...DEFAULT_CONFIG.caps, ...caps }, handoffsDir: "/run/handoffs", laneModel: null });
}

function applied(outcome: ReduceOutcome): { readonly state: RunState; readonly emits: readonly PendingEvent[]; readonly effects: readonly Effect[] } {
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function laneWithRunAttempts(attempts: Partial<StageAttempts>): RunState {
  const state = buildingState({ "T-001": aTask({ status: "impl_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha: TESTS_SHA }) });
  return { ...state, stageAttempts: { ...state.stageAttempts, ...attempts } };
}

function finding(rules: readonly TransitionRule[], state: RunState, type: string, specIds: readonly string[]): ReturnType<typeof applied> {
  return applied(reduce(rules, state, delivered("task.finding", { taskId: "T-001", type, specIds, detail: "reported by the implementer" }), new Set()));
}

describe("lane route to the planner with a re-cut cap of two", () => {
  const rules = rulesWith({ plannerRecuts: 2 });

  // @covers factory:DLT-015
  it("routes a TASK-OVERFLOW to the planner at attempt 2 after one re-cut in the run", () => {
    const state = laneWithRunAttempts({ plannerRecuts: 1 });

    const result = finding(rules, state, "TASK-OVERFLOW", []);

    expect(result.emits).toEqual([
      { type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "planner", attempt: 2, reason: "task_overflow", findingPath: "/run/handoffs/tasks/T-001/implementer-1/handoff.md" } },
    ]);
  });

  // @covers factory:DLT-015
  it("fails the task with cap_exhausted on a TASK-OVERFLOW after two re-cuts in the run", () => {
    const state = laneWithRunAttempts({ plannerRecuts: 2 });

    const result = finding(rules, state, "TASK-OVERFLOW", []);

    expect(result.emits).toEqual([{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "planner" } }]);
  });
});

describe("lane route to the architect with a repair cap of two", () => {
  const rules = rulesWith({ architectRepairs: 2 });

  // @covers factory:DLT-015
  it("routes a VD-INFEASIBLE to the architect at attempt 2 after one repair in the run", () => {
    const state = laneWithRunAttempts({ architectRepairs: 1 });

    const result = finding(rules, state, "VD-INFEASIBLE", ["greeter:BEH-001"]);

    expect(result.emits).toEqual([
      {
        type: "task.rework",
        producer: "foreman",
        payload: { taskId: "T-001", target: "architect", attempt: 2, reason: "design_repair", findingPath: "/run/handoffs/tasks/T-001/implementer-1/handoff.md", specIds: ["greeter:BEH-001"] },
      },
    ]);
  });

  // @covers factory:DLT-015
  it("fails the task with cap_exhausted on a VD-INFEASIBLE after two repairs in the run", () => {
    const state = laneWithRunAttempts({ architectRepairs: 2 });

    const result = finding(rules, state, "VD-INFEASIBLE", ["greeter:BEH-001"]);

    expect(result.emits).toEqual([{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "architect" } }]);
  });
});
