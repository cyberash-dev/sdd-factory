import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type PendingEvent } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { runAssume } from "../../src/spec-stage/application/assume.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import { CLI_SPEC, criticHandoff, effectContext, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type StageWorkspace } from "../spec-stage/harness.js";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { aTask, buildingState, delivered, IMPL_SHA, TESTS_SHA } from "./support/state.js";

const rules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });

const contractEffect: Effect = { kind: "spec.assume", specIds: ["greeter:BEH-001"], finding: "six records contradict each other", taskIds: ["T-001"], taskId: "T-001", findingPath: "reviews/T-001.md" };

function contractRouteState(implSha: string | null, worktree: string): RunState {
  return buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha: TESTS_SHA, implSha, worktree }) }, { assumptionsByRecord: { "greeter:BEH-001": 1 } });
}

function handoffWithoutAssumption(ws: StageWorkspace): () => Promise<void> {
  return () => writeText(join(ws.handoffsDir, "tasks", "T-001", "spec-critic-1", "handoff.md"), criticHandoff(1, "accept", { assumptions_added: ["greeter:ASM-001"] }));
}

async function anAssumptionStepThatMintsNothing(state: RunState): Promise<{ readonly published: readonly PendingEvent[]; readonly logs: readonly string[] }> {
  const ws = await stageWorkspace(CLI_SPEC);
  const roles = scriptedRoles([handoffWithoutAssumption(ws), handoffWithoutAssumption(ws)]);
  const logs: string[] = [];
  const { context, published } = effectContext(state);
  await runAssume(contractEffect, context, { ...sliceContext(ws, roles), log: (line) => logs.push(line) }, { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });
  return { published, logs };
}

function onlyEffectOf(state: RunState, event: PendingEvent | undefined): Effect {
  if (event === undefined) {
    throw new Error("expected the assumption step to publish an event");
  }
  const outcome = reduce(rules, state, delivered(event.type, event.payload), new Set());
  const effect = outcome.kind === "applied" ? outcome.result.effects[0] : undefined;
  if (effect === undefined) {
    throw new Error(`expected one effect from ${event.type}, got ${outcome.kind}`);
  }
  return effect;
}

async function aMergeableReviewedTask(): Promise<{ readonly productDir: string; readonly worktree: string }> {
  const productDir = await aProductRepo({ "src/greet.ts": "export const greeting = 'base';\n" });
  await git(productDir, ["checkout", "-q", "-b", "task/T-001"]);
  await writeProductFile(productDir, "src/greet.ts", "export const greeting = 'task';\n");
  await git(productDir, ["commit", "-q", "-am", "task change"]);
  await git(productDir, ["checkout", "-q", "integration"]);
  const worktree = await mkdtemp(join(tmpdir(), "sdd-worktree-"));
  await writeProductFile(worktree, "reviews/T-001.md", "# Review T-001\n");
  return { productDir, worktree };
}

async function aGreenTaskThroughTheContractRoute(): Promise<readonly PendingEvent[]> {
  const { productDir, worktree } = await aMergeableReviewedTask();
  const state = contractRouteState(IMPL_SHA, worktree);
  const assumption = await anAssumptionStepThatMintsNothing(state);
  const harness = await aLaneHarness({ productDir, design: greeterDesign() });
  const approvals: PendingEvent[] = [];
  const integrate = onlyEffectOf(state, assumption.published[0]);
  await harness.slice.effects[integrate.kind]?.(integrate, harness.effectContext(state, approvals), harness.context);
  return [...assumption.published.filter((event) => event.type === "task.failed"), ...approvals];
}

describe("contract route whose assumption step mints no assumption", () => {
  // @covers build-stage:DLT-014
  // @covers build-stage:BEH-008
  // @covers build-stage:BEH-013
  it("approves the green task with its verified implSha and publishes no task.failed", async () => {
    const outcome = await aGreenTaskThroughTheContractRoute();

    expect(outcome).toEqual([{ type: "task.approved", producer: "foreman", payload: { taskId: "T-001", implSha: IMPL_SHA } }]);
  });

  // @covers build-stage:DLT-014
  it("logs that the green task was approved with the review findings kept as advisory", async () => {
    const assumption = await anAssumptionStepThatMintsNothing(contractRouteState(IMPL_SHA, "/run/worktrees/T-001"));

    expect(assumption.logs).toContain("T-001 approved on green evidence: contract route minted no assumption, review findings kept as advisory");
  });

  // @covers build-stage:DLT-014
  // @covers build-stage:BEH-008
  it("fails the task with unparseable_handoff in arbitration mode, where there is no green evidence", async () => {
    const assumption = await anAssumptionStepThatMintsNothing(contractRouteState(null, "/run/worktrees/T-001"));

    expect(assumption.published).toEqual([{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "unparseable_handoff", detail: "spec/assumptions.md must gain exactly one ASSUMPTION record, it gained 0" } }]);
  });
});
