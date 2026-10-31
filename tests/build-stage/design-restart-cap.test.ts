import { describe, expect, it } from "vitest";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type PendingEvent, type ReduceOutcome } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { aTask, BASE_SHA, buildingState, delivered, IMPL_SHA, TESTS_SHA } from "./support/state.js";

const rules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });

function applied(outcome: ReduceOutcome): { readonly state: RunState; readonly emits: readonly PendingEvent[]; readonly effects: readonly Effect[] } {
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function run(state: RunState, type: Parameters<typeof delivered>[0], payload: Parameters<typeof delivered>[1]): ReturnType<typeof applied> {
  return applied(reduce(rules, state, delivered(type, payload), new Set()));
}

function testWriterRework(attempt: number, reason: string): Parameters<typeof delivered>[1] {
  return { taskId: "T-001", target: "test-writer", attempt, reason, findingPath: null };
}

function reauthoredOnce(): RunState {
  return buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 1, testWriter: 2 }, implementerAtRestart: 1, baseSha: BASE_SHA, testsSha: TESTS_SHA, implSha: IMPL_SHA }) });
}

function freshLane(): RunState {
  return buildingState({ "T-001": aTask({ status: "impl_pending", attempts: { implementer: 1, testWriter: 1 }, baseSha: BASE_SHA, testsSha: TESTS_SHA }) });
}

describe("test-writer restarts caused by a design repair", () => {
  // @covers build-stage:DLT-011
  // @covers build-stage:BEH-004
  it("restarts the lane at the next attempt on an architect repair after the tests were re-authored once", () => {
    const state = reauthoredOnce();

    const result = run(state, "task.rework", testWriterRework(3, "architect_repair: greeter:BEH-001"));

    expect([result.emits, result.effects]).toEqual([
      [],
      [{ kind: "build.restart-lane", taskId: "T-001", attempt: 3, reworkFinding: { reason: "architect_repair: greeter:BEH-001", findingPath: null } }],
    ]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:BEH-004
  it("restarts the lane at the next attempt on a planner re-cut after the tests were re-authored once", () => {
    const state = reauthoredOnce();

    const result = run(state, "task.rework", testWriterRework(3, "planner_recut"));

    expect([result.emits, result.effects]).toEqual([
      [],
      [{ kind: "build.restart-lane", taskId: "T-001", attempt: 3, reworkFinding: { reason: "planner_recut", findingPath: null } }],
    ]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:CST-002
  it("fails the task on a routed rework that follows an architect repair of tests already re-authored once", () => {
    const repaired = run(reauthoredOnce(), "task.rework", testWriterRework(3, "architect_repair: greeter:BEH-001")).state;

    const result = run(repaired, "task.rework", testWriterRework(4, "review_changes"));

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:BEH-004
  it("restarts the lane on both of two consecutive design repairs of a fresh task with attempts 2 and 3", () => {
    const first = run(freshLane(), "task.rework", testWriterRework(2, "architect_repair: greeter:BEH-001"));

    const second = run(first.state, "task.rework", testWriterRework(3, "planner_recut"));

    expect([...first.effects, ...second.effects].map((effect) => [effect.kind, effect["attempt"]])).toEqual([
      ["build.restart-lane", 2],
      ["build.restart-lane", 3],
    ]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:BEH-004
  it("restarts the lane at attempt 4 on the first routed rework after two design repairs", () => {
    const first = run(freshLane(), "task.rework", testWriterRework(2, "architect_repair: greeter:BEH-001")).state;
    const second = run(first, "task.rework", testWriterRework(3, "planner_recut")).state;

    const result = run(second, "task.rework", testWriterRework(4, "review_changes"));

    expect([result.emits, result.effects]).toEqual([
      [],
      [{ kind: "build.restart-lane", taskId: "T-001", attempt: 4, reworkFinding: { reason: "review_changes", findingPath: null } }],
    ]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:CST-002
  it("fails the task on the second routed rework after two design repairs", () => {
    const first = run(freshLane(), "task.rework", testWriterRework(2, "architect_repair: greeter:BEH-001")).state;
    const second = run(first, "task.rework", testWriterRework(3, "planner_recut")).state;
    const counted = run(second, "task.rework", testWriterRework(4, "review_changes")).state;

    const result = run(counted, "task.rework", testWriterRework(5, "review_changes"));

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:BEH-004
  it("restarts the lane at attempt 3 on the first rejection of tests authored after a design repair", () => {
    const repaired = run(freshLane(), "task.rework", testWriterRework(2, "architect_repair: greeter:BEH-001")).state;

    const result = run(repaired, "task.tests_rejected", { taskId: "T-001", reason: "vacuous", detail: "no tests" });

    expect([result.emits, result.effects]).toEqual([
      [],
      [{ kind: "build.restart-lane", taskId: "T-001", attempt: 3, reworkFinding: { reason: "vacuous: no tests", findingPath: null } }],
    ]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:CST-002
  it("fails the task on the second rejection after a design repair", () => {
    const repaired = run(freshLane(), "task.rework", testWriterRework(2, "architect_repair: greeter:BEH-001")).state;
    const rejected = run(repaired, "task.tests_rejected", { taskId: "T-001", reason: "vacuous", detail: "no tests" }).state;

    const result = run(rejected, "task.tests_rejected", { taskId: "T-001", reason: "vacuous", detail: "still no tests" });

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });

  // @covers build-stage:DLT-011
  // @covers build-stage:CST-002
  it("counts every test-writer attempt of a task recorded without design restarts, as written before this change", () => {
    const state = buildingState({ "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 2 }, baseSha: BASE_SHA }) });

    const result = run(state, "task.rework", testWriterRework(3, "review_changes"));

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });
});
