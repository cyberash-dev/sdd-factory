import { describe, expect, it } from "vitest";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type PendingEvent, type ReduceOutcome } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { aTask, BASE_SHA, buildingState, delivered } from "./support/state.js";

const rules = buildStageRules({ caps: { ...DEFAULT_CONFIG.caps, testWriterRework: 2 }, handoffsDir: "/run/handoffs", laneModel: null });

function applied(outcome: ReduceOutcome): { readonly state: RunState; readonly emits: readonly PendingEvent[]; readonly effects: readonly Effect[] } {
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function rejected(testWriterAttempts: number): ReturnType<typeof applied> {
  const state = buildingState({ "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: testWriterAttempts }, baseSha: BASE_SHA }) });
  return applied(reduce(rules, state, delivered("task.tests_rejected", { taskId: "T-001", reason: "vacuous", detail: "no tests" }), new Set()));
}

describe("test-writer rework cap of two", () => {
  // @covers build-stage:DLT-012
  // @covers build-stage:CST-002
  // @covers factory:DLT-015
  it("restarts the lane at attempt 3 when tests re-authored once are rejected", () => {
    const result = rejected(2);

    expect([result.emits, result.effects]).toEqual([[], [{ kind: "build.restart-lane", taskId: "T-001", attempt: 3, reworkFinding: { reason: "vacuous: no tests", findingPath: null } }]]);
  });

  // @covers build-stage:DLT-012
  // @covers build-stage:CST-002
  // @covers factory:DLT-015
  it("fails the task with detail test-writer when tests re-authored twice are rejected", () => {
    const result = rejected(3);

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });
});
