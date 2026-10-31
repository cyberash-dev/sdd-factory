import { describe, expect, it } from "vitest";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../src/bus/domain/envelope.js";
import type { RunState, StageAttempts } from "../../src/bus/domain/run-state.js";
import { reduce, type TransitionResult, type TransitionRule } from "../../src/bus/domain/transition.js";
import { createDesignRules } from "../../src/design-stage/domain/rules.js";
import { DEFAULT_CONFIG, type Caps } from "../../src/shared/config.js";
import { stateIn } from "./harness.js";

function rulesWith(caps: Partial<Caps>): readonly TransitionRule[] {
  return createDesignRules({ caps: { ...DEFAULT_CONFIG.caps, ...caps }, worktreesDir: "/run/worktrees" });
}

function applied(rules: readonly TransitionRule[], state: RunState, type: EventType, payload: EventPayload): TransitionResult {
  const event: DeliveredEvent<EventType> = { type, runId: state.runId, occurredAt: "2026-10-31T12:00:01.000Z", producer: "foreman", payload, seq: 9 };
  const outcome = reduce(rules, state, event, new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function stateWithAttempts(status: RunState["status"], attempts: Partial<StageAttempts>): RunState {
  const base = stateIn(status);
  return { ...base, stageAttempts: { ...base.stageAttempts, ...attempts } };
}

describe("planner re-cut cap of two", () => {
  const rules = rulesWith({ plannerRecuts: 2 });

  // @covers factory:DLT-015
  it("runs a second planner re-cut at attempt 3 after one re-cut", () => {
    const state = stateWithAttempts("planning", { plannerRecuts: 1 });

    const result = applied(rules, state, "design.rework", { target: "planner", reason: "uncovered_id: todo-cli:BEH-003", attempt: 2 });

    expect([result.emits, result.effects]).toEqual([[], [{ kind: "design.plan", attempt: 3, reworkFinding: "uncovered_id: todo-cli:BEH-003" }]]);
  });

  // @covers factory:DLT-015
  it("blocks the design with planner_cap on the planner failure after two re-cuts", () => {
    const state = stateWithAttempts("planning", { plannerRecuts: 2 });

    const result = applied(rules, state, "design.rework", { target: "planner", reason: "uncovered_id: todo-cli:BEH-003", attempt: 3 });

    expect([result.emits, result.effects]).toEqual([[{ type: "design.blocked", producer: "foreman", payload: { reason: "planner_cap" } }], []]);
  });
});

describe("architect repair cap of two", () => {
  const rules = rulesWith({ architectRepairs: 2 });

  // @covers factory:DLT-015
  it("runs a second architect repair at attempt 3 after one repair", () => {
    const state = stateWithAttempts("building", { architectRepairs: 1 });

    const result = applied(rules, state, "design.rework", { target: "architect", reason: "VD-INFEASIBLE: clock not injectable", attempt: 2, specIds: ["todo-cli:BEH-002"] });

    expect([result.emits, result.effects]).toEqual([[], [{ kind: "design.architect", attempt: 3, reworkFinding: "VD-INFEASIBLE: clock not injectable", specIds: ["todo-cli:BEH-002"] }]]);
  });

  // @covers factory:DLT-015
  it("fails the run with cap_exhausted on the architect repair after two repairs", () => {
    const state = stateWithAttempts("building", { architectRepairs: 2 });

    const result = applied(rules, state, "design.rework", { target: "architect", reason: "VD-INFEASIBLE: clock not injectable", attempt: 3, specIds: ["todo-cli:BEH-002"] });

    expect([result.emits, result.effects]).toEqual([
      [{ type: "run.failed", producer: "foreman", payload: { stage: "design", reason: "cap_exhausted", detail: "architect repairs cap 2 exceeded: VD-INFEASIBLE: clock not injectable" } }],
      [],
    ]);
  });
});
