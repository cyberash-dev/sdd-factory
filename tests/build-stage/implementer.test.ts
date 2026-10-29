import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness, type LaneHarness } from "./support/harness.js";
import { GREEN_IMPL, handoffPathFromWorktree, handoffPathOf, laneState, provisionLane, RED_TEST, runLaneEffect, type ProvisionedLane } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { scriptedCliRoles, writeHandoff, type ScriptedCliRoles } from "./support/runners.js";
import type { RunState } from "../../src/bus/domain/run-state.js";

interface FrozenLane {
  readonly harness: LaneHarness;
  readonly lane: ProvisionedLane;
  readonly cliRoles: ScriptedCliRoles;
  readonly state: RunState;
}

async function frozenLane(cliRoles: ScriptedCliRoles): Promise<FrozenLane> {
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
  const lane = await provisionLane(harness);
  await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
  await git(lane.worktree, ["add", "-A"]);
  await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
  const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
  return { harness, lane, cliRoles, state: laneState(lane, { status: "impl_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha }) };
}

describe("implementer invocation", () => {
  // @covers build-stage:BEH-005
  it("names the frozen test files and the write-set in the first message and publishes task.impl_done with cost fields", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeProductFile(request.cwd, "src/greet.ts", GREEN_IMPL);
      await writeHandoff(handoffPathFromWorktree(request.cwd, "implementer", 1), { role: "implementer", attempt: 1, status: "complete", changed_files: ["src/greet.ts"] });
    });
    const { harness, state } = await frozenLane(cliRoles);

    const published = await runLaneEffect(harness, "build.implementer", { taskId: "T-001", attempt: 1, reworkFinding: null }, state);

    const message = cliRoles.requests[0]?.prompt.split("\n\n---\n\n")[1] ?? "";
    expect([
      ["## Frozen test files (read-only)\n\n- `tests/greet.test.ts`", '"writes": [\n    "src/greet.ts",\n    "tests/greet.test.ts"\n  ]', "export function greet(name: string): string;", handoffPathOf(harness, "implementer", 1)].map((item) => message.includes(item)),
      published,
    ]).toEqual([
      [true, true, true, true],
      [{ type: "task.impl_done", producer: "implementer", payload: { taskId: "T-001", attempt: 1, handoffPath: handoffPathOf(harness, "implementer", 1), costUsd: 0.05, inputTokens: 1000, outputTokens: 200, durationMs: 1500 } }],
    ]);
  });

  it("publishes task.finding with the declared type, spec ids and detail", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "implementer", 1), { role: "implementer", attempt: 1, status: "finding", changed_files: [], finding: { type: "TASK-OVERFLOW", spec_ids: ["greeter:BEH-001"], detail: "missing_dependency: chalk" } });
    });
    const { harness, state } = await frozenLane(cliRoles);

    const published = await runLaneEffect(harness, "build.implementer", { taskId: "T-001", attempt: 1, reworkFinding: null }, state);

    expect(published).toEqual([{ type: "task.finding", producer: "implementer", payload: { taskId: "T-001", type: "TASK-OVERFLOW", specIds: ["greeter:BEH-001"], detail: "missing_dependency: chalk", origin: "implementer" } }]);
  });

  it("treats a finding type outside the closed set as a malformed handoff", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "implementer", 1), { role: "implementer", attempt: 1, status: "finding", changed_files: [], finding: { type: "SOMETHING-ELSE", spec_ids: [], detail: "x" } });
    });
    const { harness, state } = await frozenLane(cliRoles);

    const published = await runLaneEffect(harness, "build.implementer", { taskId: "T-001", attempt: 1, reworkFinding: null }, state);

    expect([cliRoles.requests.length, published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])]).toEqual([2, [["task.failed", "unparseable_handoff", "implementer: invalid_enum_value:finding.type"]]]);
  });

  it("publishes task.failed with reason blocked when the handoff declares blocked", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "implementer", 1), { role: "implementer", attempt: 1, status: "blocked", changed_files: [] }, "frozen test list empty\n");
    });
    const { harness, state } = await frozenLane(cliRoles);

    const published = await runLaneEffect(harness, "build.implementer", { taskId: "T-001", attempt: 1, reworkFinding: null }, state);

    expect(published.map((event) => [event.type, event.payload["reason"]])).toEqual([["task.failed", "blocked"]]);
  });

  it("includes the verifier evidence of the red run in the first message of a rework attempt", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "implementer", 2), { role: "implementer", attempt: 2, status: "complete", changed_files: ["src/greet.ts"] });
    });
    const { harness, lane, state } = await frozenLane(cliRoles);
    const evidencePath = join(harness.context.paths.handoffsDir, "tasks", "T-001", "verifier-green-1.json");
    await writeProductFile(dirname(evidencePath), "verifier-green-1.json", '{"verdict":"fail","reasons":["tests_failed"]}\n');

    await runLaneEffect(harness, "build.implementer", { taskId: "T-001", attempt: 2, reworkFinding: { reason: "verification_red", findingPath: evidencePath } }, laneState(lane, { status: "impl_pending", attempts: { implementer: 2, testWriter: 1 }, testsSha: state.tasks["T-001"]?.testsSha ?? null }));

    const prompt = cliRoles.requests[0]?.prompt ?? "";
    expect([prompt.includes(`verification_red\nsource: ${evidencePath}`), prompt.includes('"reasons":["tests_failed"]'), prompt.includes("This is attempt 2 of at most 3")]).toEqual([true, true, true]);
  });

  it("never includes the test-writer transcript: the message carries only paths of the frozen tests, not a conversation", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "implementer", 1), { role: "implementer", attempt: 1, status: "complete", changed_files: [] });
    });
    const { harness, state } = await frozenLane(cliRoles);

    await runLaneEffect(harness, "build.implementer", { taskId: "T-001", attempt: 1, reworkFinding: null }, state);

    const prompt = cliRoles.requests[0]?.prompt ?? "";
    expect([prompt.includes("role: implementer"), prompt.includes("TEST-WRITER for task"), prompt.includes("## Previous handoff")]).toEqual([true, false, false]);
  });
});
