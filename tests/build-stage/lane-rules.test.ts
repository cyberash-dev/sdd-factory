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

const verifiedRed = (taskId: string) => ({ taskId, result: "red", evidencePath: `/run/handoffs/tasks/${taskId}/verifier-green-1.json`, testsUnchanged: true, writeSetOk: true, implSha: null });
const reviewed = (decision: string, target: string, extra: Record<string, unknown> = {}) => ({ taskId: "T-001", decision, target, reportPath: "reviews/T-001.md", ...extra });

describe("lane start and test authoring", () => {
  // @covers build-stage:BEH-001
  it("moves a ready task to tests_pending with the base sha and starts the test-writer at attempt 1", () => {
    const state = buildingState({ "T-001": aTask({ worktree: "" }) });

    const result = run(state, "task.ready", { taskId: "T-001", worktree: "/run/worktrees/T-001", baseSha: BASE_SHA, covers: ["greeter:BEH-001"], writes: ["src/greet.ts", "tests/greet.test.ts"] });

    expect([result.state.tasks["T-001"]?.status, result.state.tasks["T-001"]?.baseSha, result.state.tasks["T-001"]?.attempts, result.effects]).toEqual([
      "tests_pending",
      BASE_SHA,
      { implementer: 0, testWriter: 1 },
      [{ kind: "build.test-writer", taskId: "T-001", attempt: 1, reworkFinding: null }],
    ]);
  });

  it("ignores task.ready for a task that already started", () => {
    const state = buildingState({ "T-001": aTask({ status: "impl_pending" }) });

    const outcome = reduce(rules, state, delivered("task.ready", { taskId: "T-001", worktree: "/w", baseSha: BASE_SHA, covers: [], writes: [] }), new Set());

    expect(outcome.kind).toBe("out_of_order_ignored");
  });

  // @covers build-stage:CST-006
  it("records the test-writer cost in the ledger and schedules the red check with the firewall findings", () => {
    const state = buildingState({ "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 1 } }) });

    const result = run(state, "task.tests_written", { taskId: "T-001", attempt: 1, handoffPath: "/h.md", costUsd: 0.5, inputTokens: 100, outputTokens: 20, durationMs: 900, firewallViolations: ["Read:src/greet.ts"] });

    expect([result.state.costLedger, result.effects]).toEqual([
      { entries: [{ participant: "test-writer", taskId: "T-001", stage: "build", costUsd: 0.5, inputTokens: 100, outputTokens: 20, model: null, durationMs: 900 }], totalUsd: 0.5 },
      [{ kind: "build.red-check", taskId: "T-001", attempt: 1, firewallViolations: ["Read:src/greet.ts"] }],
    ]);
  });

  // @covers build-stage:BEH-003
  it("freezes the tests sha and starts implementer attempt 1 on task.tests_red", () => {
    const state = buildingState({ "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 1 }, baseSha: BASE_SHA }) });

    const result = run(state, "task.tests_red", { taskId: "T-001", testsSha: TESTS_SHA, testFiles: ["tests/greet.test.ts"] });

    expect([result.state.tasks["T-001"]?.status, result.state.tasks["T-001"]?.testsSha, result.state.tasks["T-001"]?.attempts.implementer, result.effects]).toEqual([
      "impl_pending",
      TESTS_SHA,
      1,
      [{ kind: "build.implementer", taskId: "T-001", attempt: 1, reworkFinding: null }],
    ]);
  });

  // @covers build-stage:BEH-004
  it("restarts the lane with the rejection as rework finding after the first rejection", () => {
    const state = buildingState({ "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 1 }, baseSha: BASE_SHA }) });

    const result = run(state, "task.tests_rejected", { taskId: "T-001", reason: "vacuous", detail: "no tests" });

    expect([result.state.tasks["T-001"]?.attempts, result.emits, result.effects]).toEqual([
      { implementer: 0, testWriter: 2 },
      [],
      [{ kind: "build.restart-lane", taskId: "T-001", attempt: 2, reworkFinding: { reason: "vacuous: no tests", findingPath: null } }],
    ]);
  });

  // @covers build-stage:CST-002
  it("fails the task with detail test-writer on the second rejection", () => {
    const state = buildingState({ "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 2 } }) });

    const result = run(state, "task.tests_rejected", { taskId: "T-001", reason: "suite_error", detail: "load" });

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });

  it("clears the implementation state when a reviewer routes a lane restart after an implementation existed", () => {
    const state = buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 2, testWriter: 1 }, baseSha: BASE_SHA, testsSha: TESTS_SHA, implSha: IMPL_SHA }) });

    const result = run(state, "task.rework", { taskId: "T-001", target: "test-writer", attempt: 2, reason: "review_changes", findingPath: "reviews/T-001.md" });

    expect([result.state.tasks["T-001"]?.status, result.state.tasks["T-001"]?.attempts, result.state.tasks["T-001"]?.testsSha, result.state.tasks["T-001"]?.implSha, result.effects]).toEqual([
      "tests_pending",
      { implementer: 0, testWriter: 2 },
      null,
      null,
      [{ kind: "build.restart-lane", taskId: "T-001", attempt: 2, reworkFinding: { reason: "review_changes", findingPath: "reviews/T-001.md" } }],
    ]);
  });
});

describe("verification routing", () => {
  // @covers build-stage:BEH-006
  it("records the implementer cost and schedules the green check on task.impl_done", () => {
    const state = buildingState({ "T-001": aTask({ status: "impl_pending", attempts: { implementer: 1, testWriter: 1 } }) });

    const result = run(state, "task.impl_done", { taskId: "T-001", attempt: 1, handoffPath: "/h.md", costUsd: null, inputTokens: 10, outputTokens: 5, durationMs: 100 });

    expect([result.state.tasks["T-001"]?.status, result.state.costLedger.entries[0]?.participant, result.effects]).toEqual(["verify_pending", "implementer", [{ kind: "build.green-check", taskId: "T-001", attempt: 1 }]]);
  });

  // @covers build-stage:BEH-012
  it("records implSha and invokes the reviewer in review mode on a green verification", () => {
    const state = buildingState({ "T-001": aTask({ status: "verify_pending", attempts: { implementer: 2, testWriter: 1 } }) });

    const result = run(state, "task.verified", { taskId: "T-001", result: "green", evidencePath: "/e.json", testsUnchanged: true, writeSetOk: true, implSha: IMPL_SHA });

    expect([result.state.tasks["T-001"]?.status, result.state.tasks["T-001"]?.implSha, result.emits, result.effects]).toEqual(["review_pending", IMPL_SHA, [], [{ kind: "build.reviewer", taskId: "T-001", mode: "review", attempt: 2 }]]);
  });

  // @covers build-stage:BEH-007
  // @covers build-stage:INV-004
  it("routes three consecutive red results to rework attempts 2 and 3 and then to cap_exhausted without any effect", () => {
    const attempts = [1, 2, 3];

    const results = attempts.map((implementer) => run(buildingState({ "T-001": aTask({ status: "verify_pending", attempts: { implementer, testWriter: 1 } }) }), "task.verified", verifiedRed("T-001")));

    expect(results.map((result) => [result.emits.map((event) => [event.type, event.payload["target"], event.payload["attempt"], event.payload["reason"], event.payload["findingPath"], event.payload["detail"]]), result.effects])).toEqual([
      [[["task.rework", "implementer", 2, "verification_red", "/run/handoffs/tasks/T-001/verifier-green-1.json", undefined]], []],
      [[["task.rework", "implementer", 3, "verification_red", "/run/handoffs/tasks/T-001/verifier-green-1.json", undefined]], []],
      [[["task.failed", undefined, undefined, "cap_exhausted", undefined, "implementer"]], []],
    ]);
  });

  // @covers build-stage:CST-001
  it("uses the configured implementer cap of 3", () => {
    expect(DEFAULT_CONFIG.caps.implementerAttempts).toBe(3);
  });

  it("re-runs the implementer at the next attempt with the finding on task.rework", () => {
    const state = buildingState({ "T-001": aTask({ status: "verify_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha: TESTS_SHA }) });

    const result = run(state, "task.rework", { taskId: "T-001", target: "implementer", attempt: 2, reason: "verification_red", findingPath: "/e.json" });

    expect([result.state.tasks["T-001"]?.status, result.state.tasks["T-001"]?.attempts.implementer, result.state.tasks["T-001"]?.testsSha, result.effects]).toEqual([
      "impl_pending",
      2,
      TESTS_SHA,
      [{ kind: "build.implementer", taskId: "T-001", attempt: 2, reworkFinding: { reason: "verification_red", findingPath: "/e.json" } }],
    ]);
  });
});

describe("reviewer decision routing", () => {
  const reviewState = (implementer = 1): RunState => buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer, testWriter: 1 }, testsSha: TESTS_SHA, implSha: IMPL_SHA }) });

  // @covers build-stage:BEH-013
  it.each([
    ["approve", "none"],
    ["advisory_only", "none"],
  ])("integrates the task branch on decision %s", (decision, target) => {
    const result = run(reviewState(), "task.reviewed", reviewed(decision, target));

    expect([result.emits, result.effects]).toEqual([[], [{ kind: "build.integrate", taskId: "T-001" }]]);
  });

  it.each([
    ["implementer", "task.rework", "implementer", 2, "review_changes"],
    ["test-writer", "task.rework", "test-writer", 2, "review_changes"],
    ["architect", "task.rework", "architect", 1, "design_repair"],
  ])("routes request_changes with target %s", (target, type, reworkTarget, attempt, reason) => {
    const result = run(reviewState(), "task.reviewed", reviewed("request_changes", target));

    expect(result.emits.map((event) => [event.type, event.payload["target"], event.payload["attempt"], event.payload["reason"], event.payload["findingPath"]])).toEqual([[type, reworkTarget, attempt, reason, "reviews/T-001.md"]]);
  });

  it("routes request_changes with target contract to the critic with the blocking spec ids", () => {
    const result = run(reviewState(), "task.reviewed", reviewed("request_changes", "contract", { specIds: ["greeter:BEH-001", "greeter:CTR-002"] }));

    expect(result.emits).toEqual([{ type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "critic", attempt: 1, reason: "spec_contradiction", findingPath: "reviews/T-001.md", specIds: ["greeter:BEH-001", "greeter:CTR-002"] } }]);
  });

  it("treats request_changes without a target as an unparseable handoff", () => {
    const result = run(reviewState(), "task.reviewed", reviewed("request_changes", "none"));

    expect(result.emits.map((event) => [event.type, event.payload["reason"]])).toEqual([["task.failed", "unparseable_handoff"]]);
  });

  it("counts a reviewer request_changes toward the implementer cap", () => {
    const result = run(reviewState(3), "task.reviewed", reviewed("request_changes", "implementer"));

    expect(result.emits.map((event) => [event.type, event.payload["detail"]])).toEqual([["task.failed", "implementer"]]);
  });

  it("ledgers the reviewer cost when the payload carries it", () => {
    const result = run(reviewState(), "task.reviewed", reviewed("approve", "none", { costUsd: 0.2, inputTokens: 50, outputTokens: 9, durationMs: 300, model: "claude-sonnet-5-5" }));

    expect(result.state.costLedger.entries).toEqual([{ participant: "reviewer", taskId: "T-001", stage: "build", costUsd: 0.2, inputTokens: 50, outputTokens: 9, model: "claude-sonnet-5-5", durationMs: 300 }]);
  });
});

describe("findings and arbitration", () => {
  const findingState = (overrides: Partial<RunState> = {}): RunState => buildingState({ "T-001": aTask({ status: "impl_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha: TESTS_SHA }) }, overrides);
  const arbitrationState = (implementer = 1): RunState => buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer, testWriter: 1 }, testsSha: TESTS_SHA, implSha: null }) });

  // @covers build-stage:BEH-008
  it("invokes the reviewer in arbitration mode on a TEST-CONTRACT-CONFLICT finding", () => {
    const result = run(findingState(), "task.finding", { taskId: "T-001", type: "TEST-CONTRACT-CONFLICT", specIds: ["greeter:BEH-001"], detail: "test asserts X, record says Y" });

    expect([result.state.tasks["T-001"]?.status, result.effects]).toEqual([
      "review_pending",
      [{ kind: "build.reviewer", taskId: "T-001", mode: "arbitration", attempt: 1, finding: { type: "TEST-CONTRACT-CONFLICT", specIds: ["greeter:BEH-001"], detail: "test asserts X, record says Y" } }],
    ]);
  });

  it.each([
    ["approve", "none", "implementer", "claim_rejected"],
    ["request_changes", "implementer", "implementer", "claim_rejected"],
    ["request_changes", "test-writer", "test-writer", "test_contract_conflict"],
  ])("routes arbitration decision %s target %s", (decision, target, reworkTarget, reason) => {
    const result = run(arbitrationState(), "task.reviewed", reviewed(decision, target));

    expect(result.emits.map((event) => [event.type, event.payload["target"], event.payload["reason"]])).toEqual([["task.rework", reworkTarget, reason]]);
  });

  // @covers build-stage:INV-005
  it("never approves from an arbitration decision", () => {
    const result = run(arbitrationState(), "task.reviewed", reviewed("approve", "none"));

    expect([result.emits.map((event) => event.type), result.effects]).toEqual([["task.rework"], []]);
  });

  it("counts the rejected claim toward the implementer cap", () => {
    const result = run(arbitrationState(3), "task.reviewed", reviewed("approve", "none"));

    expect(result.emits.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])).toEqual([["task.failed", "cap_exhausted", "implementer"]]);
  });

  // @covers build-stage:CST-005
  it("routes the contract target to the critic once per spec id and fails the task on the second route", () => {
    const first = run(arbitrationState(), "task.reviewed", reviewed("request_changes", "contract", { specIds: ["greeter:BEH-001"] }));
    const afterCritic = run(arbitrationState(), "task.rework", { taskId: "T-001", target: "critic", attempt: 1, reason: "spec_contradiction", findingPath: "reviews/T-001.md", specIds: ["greeter:BEH-001"] });
    const second = run({ ...arbitrationState(), assumptionsByRecord: afterCritic.state.assumptionsByRecord }, "task.reviewed", reviewed("request_changes", "contract", { specIds: ["greeter:BEH-001"] }));

    expect([first.emits.map((event) => event.payload["target"]), afterCritic.state.assumptionsByRecord, afterCritic.effects, second.emits.map((event) => [event.type, event.payload["detail"]])]).toEqual([
      ["critic"],
      { "greeter:BEH-001": 1 },
      [{ kind: "spec.assume", taskId: "T-001", specIds: ["greeter:BEH-001"], findingPath: "reviews/T-001.md", taskIds: ["T-001"] }],
      [["task.failed", "critic"]],
    ]);
  });

  // @covers build-stage:BEH-009
  // @covers build-stage:CST-003
  it("routes TASK-OVERFLOW to the planner once per run and fails the task on the second overflow", () => {
    const first = run(findingState(), "task.finding", { taskId: "T-001", type: "TASK-OVERFLOW", specIds: [], detail: "missing_dependency: zod" });
    const forwarded = run(findingState(), "task.rework", { taskId: "T-001", target: "planner", attempt: 1, reason: "task_overflow", findingPath: "/run/handoffs/tasks/T-001/implementer-1/handoff.md" });
    const second = run(findingState({ stageAttempts: { ...findingState().stageAttempts, plannerRecuts: 1 } }), "task.finding", { taskId: "T-001", type: "TASK-OVERFLOW", specIds: [], detail: "again" });

    expect([first.emits, forwarded.emits, forwarded.state.stageAttempts.plannerRecuts, second.emits.map((event) => [event.type, event.payload["detail"]])]).toEqual([
      [{ type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "planner", attempt: 1, reason: "task_overflow", findingPath: "/run/handoffs/tasks/T-001/implementer-1/handoff.md" } }],
      [{ type: "design.rework", producer: "foreman", payload: { target: "planner", reason: "task_overflow", attempt: 1 } }],
      1,
      [["task.failed", "planner"]],
    ]);
  });

  // @covers build-stage:BEH-010
  // @covers build-stage:CST-004
  it("routes VD-INFEASIBLE to the architect once per run and fails the task on the second route", () => {
    const first = run(findingState(), "task.finding", { taskId: "T-001", type: "VD-INFEASIBLE", specIds: ["greeter:BEH-001"], detail: "no entry point" });
    const forwarded = run(findingState(), "task.rework", { taskId: "T-001", target: "architect", attempt: 1, reason: "design_repair", findingPath: null });
    const second = run(findingState({ stageAttempts: { ...findingState().stageAttempts, architectRepairs: 1 } }), "task.finding", { taskId: "T-001", type: "VD-INFEASIBLE", specIds: [], detail: "again" });

    expect([first.emits.map((event) => [event.type, event.payload["target"], event.payload["reason"]]), forwarded.emits, forwarded.state.stageAttempts.architectRepairs, second.emits.map((event) => [event.type, event.payload["detail"]])]).toEqual([
      [["task.rework", "architect", "design_repair"]],
      [{ type: "design.rework", producer: "foreman", payload: { target: "architect", reason: "design_repair", attempt: 1 } }],
      1,
      [["task.failed", "architect"]],
    ]);
  });

  // @covers build-stage:BEH-011
  it("re-provisions once on TOOLING-BROKEN without counting an attempt and fails the run on the second occurrence", () => {
    const first = run(findingState(), "task.finding", { taskId: "T-001", type: "TOOLING-BROKEN", specIds: [], detail: "vitest: command not found", origin: "implementer" });
    const second = run(first.state, "task.finding", { taskId: "T-001", type: "TOOLING-BROKEN", specIds: [], detail: "still broken" });

    expect([first.effects, first.state.tasks["T-001"]?.attempts.implementer, first.state.stageHandoffReruns, second.effects, second.emits]).toEqual([
      [{ kind: "build.reprovision", taskId: "T-001", origin: "implementer", attempt: 1 }],
      1,
      { tooling: 1 },
      [],
      [{ type: "run.failed", producer: "foreman", payload: { stage: "build", reason: "tooling_broken", detail: "T-001: still broken" } }],
    ]);
  });
});

describe("approval and failure", () => {
  // @covers build-stage:BEH-013
  it("marks the task approved and schedules dependents on task.approved", () => {
    const state = buildingState({ "T-001": aTask({ status: "review_pending", implSha: IMPL_SHA }), "T-002": aTask({ dependsOn: ["T-001"] }) });

    const result = run(state, "task.approved", { taskId: "T-001", implSha: IMPL_SHA });

    expect([result.state.tasks["T-001"]?.status, result.effects]).toEqual(["approved", [{ kind: "build.schedule" }]]);
  });

  it("also starts the assembly when the last task is approved", () => {
    const state = buildingState({ "T-001": aTask({ status: "approved", implSha: IMPL_SHA }), "T-002": aTask({ status: "review_pending", implSha: IMPL_SHA, dependsOn: ["T-001"] }) });

    const result = run(state, "task.approved", { taskId: "T-002", implSha: IMPL_SHA });

    expect(result.effects).toEqual([{ kind: "build.schedule" }, { kind: "assembly.start" }]);
  });

  // @covers build-stage:BEH-014
  it.each([
    ["implementer", buildingState({ "T-001": aTask({ status: "verify_pending", attempts: { implementer: 3, testWriter: 1 } }) }), "task.verified", verifiedRed("T-001")],
    ["test-writer", buildingState({ "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 2 } }) }), "task.tests_rejected", { taskId: "T-001", reason: "vacuous", detail: "x" }],
    ["planner", buildingState({ "T-001": aTask({ status: "impl_pending", attempts: { implementer: 1, testWriter: 1 } }) }, { stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 1, architectRepairs: 0, assemblyRounds: 0 } }), "task.finding", { taskId: "T-001", type: "TASK-OVERFLOW", specIds: [], detail: "x" }],
    ["architect", buildingState({ "T-001": aTask({ status: "impl_pending", attempts: { implementer: 1, testWriter: 1 } }) }, { stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 0, architectRepairs: 1, assemblyRounds: 0 } }), "task.finding", { taskId: "T-001", type: "VD-INFEASIBLE", specIds: [], detail: "x" }],
    ["critic", buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 1, testWriter: 1 } }) }, { assumptionsByRecord: { "greeter:BEH-001": 1 } }), "task.reviewed", reviewed("request_changes", "contract", { specIds: ["greeter:BEH-001"] })],
  ] as const)("exceeding the %s cap by one emits task.failed with the role in detail and starts no effect", (role, state, type, payload) => {
    const result = run(state, type, payload);

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: role } }], []]);
  });

  // @covers build-stage:BEH-016
  it("fails the run with stage build and terminates the other lanes on the first task.failed", () => {
    const state = buildingState({ "T-001": aTask({ status: "verify_pending" }), "T-002": aTask({ status: "impl_pending" }) });

    const result = run(state, "task.failed", { taskId: "T-001", reason: "cap_exhausted", detail: "implementer" });

    expect([result.state.tasks["T-001"]?.status, result.emits, result.effects]).toEqual([
      "failed",
      [{ type: "run.failed", producer: "foreman", payload: { stage: "build", reason: "cap_exhausted", detail: "T-001: cap_exhausted: implementer" } }],
      [{ kind: "build.terminate-lanes" }],
    ]);
  });

  it("maps a blocked role to run.failed reason runtime_error", () => {
    const state = buildingState({ "T-001": aTask({ status: "tests_pending" }) });

    const result = run(state, "task.failed", { taskId: "T-001", reason: "blocked", detail: "test-writer: no tests glob" });

    expect(result.emits.map((event) => [event.payload["reason"], event.payload["detail"]])).toEqual([["runtime_error", "T-001: blocked: test-writer: no tests glob"]]);
  });

  it("declares exactly one rule per lane event type", () => {
    expect(rules.map((rule) => rule.eventType).sort()).toEqual([
      "task.approved",
      "task.failed",
      "task.finding",
      "task.impl_done",
      "task.ready",
      "task.reviewed",
      "task.rework",
      "task.tests_red",
      "task.tests_rejected",
      "task.tests_written",
      "task.verified",
    ]);
  });
});
