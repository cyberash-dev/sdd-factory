import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunState, StageAttempts, TaskAttempts } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type PendingEvent, type ReduceOutcome } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { aTask, buildingState, delivered, IMPL_SHA, TESTS_SHA } from "./support/state.js";

const rules = buildStageRules({ caps: { ...DEFAULT_CONFIG.caps, implementerAttempts: 2, testWriterRework: 2, architectRepairs: 2, criticAssumptionsPerId: 2 }, handoffsDir: "/run/handoffs", laneModel: null });

function applied(outcome: ReduceOutcome): { readonly state: RunState; readonly emits: readonly PendingEvent[]; readonly effects: readonly Effect[] } {
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function stageAttemptsWithArchitectRepairs(architectRepairs: number): StageAttempts {
  return { lintCycles: 0, criticRounds: 0, plannerRecuts: 0, architectRepairs, assemblyRounds: 0, specGateReworks: 0 };
}

function verifiedGreen(attempts: TaskAttempts, overrides: Partial<RunState> = {}, designRestarts = 0): RunState {
  return buildingState({ "T-001": aTask({ status: "review_pending", attempts, designRestarts, testsSha: TESTS_SHA, implSha: IMPL_SHA }) }, overrides);
}

function underArbitration(attempts: TaskAttempts): RunState {
  return buildingState({ "T-001": aTask({ status: "review_pending", attempts, testsSha: TESTS_SHA, implSha: null }) });
}

function changesRequested(state: RunState, target: string, specIds: readonly string[] = []): ReturnType<typeof applied> {
  return applied(reduce(rules, state, delivered("task.reviewed", { taskId: "T-001", decision: "request_changes", target, reportPath: "reviews/T-001.md", specIds }), new Set()));
}

async function aProductWithMergeableTaskBranch(): Promise<string> {
  const productDir = await aProductRepo({ "src/greet.ts": "export const greeting = 'base';\n" });
  await git(productDir, ["checkout", "-q", "-b", "task/T-001"]);
  await writeProductFile(productDir, "src/greet.ts", "export const greeting = 'task';\n");
  await git(productDir, ["commit", "-q", "-am", "task change"]);
  await git(productDir, ["checkout", "-q", "integration"]);
  return productDir;
}

async function aCappedReviewIntegration(): Promise<{ readonly published: readonly PendingEvent[]; readonly logs: readonly string[] }> {
  const productDir = await aProductWithMergeableTaskBranch();
  const worktree = await mkdtemp(join(tmpdir(), "sdd-worktree-"));
  await writeProductFile(worktree, "reviews/T-001.md", "# Review T-001\n");
  const harness = await aLaneHarness({ productDir, design: greeterDesign() });
  const state = buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 2, testWriter: 1 }, implSha: IMPL_SHA, worktree }) });
  const published: PendingEvent[] = [];
  await harness.slice.effects["build.integrate"]?.({ kind: "build.integrate", taskId: "T-001", capReachedRole: "implementer" }, harness.effectContext(state, published), harness.context);
  return { published, logs: harness.logs };
}

describe("review whose route is at the role's cap", () => {
  // @covers build-stage:DLT-013
  // @covers build-stage:BEH-013
  // @covers build-stage:BEH-014
  it.each([
    ["implementer", "implementer", verifiedGreen({ implementer: 2, testWriter: 1 }), []],
    ["test-writer", "test-writer", verifiedGreen({ implementer: 1, testWriter: 3 }), []],
    ["architect", "architect", verifiedGreen({ implementer: 1, testWriter: 1 }, { stageAttempts: stageAttemptsWithArchitectRepairs(2) }), []],
    ["contract", "critic", verifiedGreen({ implementer: 1, testWriter: 1 }, { assumptionsByRecord: { "greeter:BEH-001": 2 } }), ["greeter:BEH-001"]],
  ] as const)("integrates the green task instead of failing it when the %s route is at its cap", (target, role, state, specIds) => {
    const result = changesRequested(state, target, specIds);

    expect([result.emits, result.effects]).toEqual([[], [{ kind: "build.integrate", taskId: "T-001", capReachedRole: role }]]);
  });

  // @covers build-stage:DLT-013
  // @covers build-stage:BEH-013
  it.each([
    ["implementer", verifiedGreen({ implementer: 1, testWriter: 1 }), "implementer", 2, "review_changes"],
    ["test-writer", verifiedGreen({ implementer: 1, testWriter: 3 }, {}, 1), "test-writer", 4, "review_changes"],
    ["architect", verifiedGreen({ implementer: 1, testWriter: 1 }, { stageAttempts: stageAttemptsWithArchitectRepairs(1) }), "architect", 2, "design_repair"],
  ] as const)("routes the %s rework when the route is under its cap", (target, state, reworkTarget, attempt, reason) => {
    const result = changesRequested(state, target);

    expect([result.emits.map((event) => [event.type, event.payload["target"], event.payload["attempt"], event.payload["reason"]]), result.effects]).toEqual([[["task.rework", reworkTarget, attempt, reason]], []]);
  });

  // @covers build-stage:DLT-013
  // @covers build-stage:BEH-014
  it("fails the task with cap_exhausted when an arbitration request_changes finds the implementer at its cap", () => {
    const result = changesRequested(underArbitration({ implementer: 2, testWriter: 1 }), "implementer");

    expect([result.emits, result.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "implementer" } }], []]);
  });

  // @covers build-stage:DLT-013
  // @covers build-stage:BEH-013
  it("publishes task.approved with the verified implSha after merging a capped review", async () => {
    const integration = await aCappedReviewIntegration();

    expect(integration.published).toEqual([{ type: "task.approved", producer: "foreman", payload: { taskId: "T-001", implSha: IMPL_SHA } }]);
  });

  // @covers build-stage:DLT-013
  it("logs that the task was approved on green evidence with the review findings kept as advisory", async () => {
    const integration = await aCappedReviewIntegration();

    expect(integration.logs).toContain("T-001 approved on green evidence: implementer cap reached, review findings kept as advisory");
  });
});
