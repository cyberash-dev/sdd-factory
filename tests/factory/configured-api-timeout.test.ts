import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { triageEffect } from "../../src/assembly-stage/application/triage.js";
import { runArchitectEffect } from "../../src/design-stage/application/architect-effect.js";
import { DEFAULT_CONFIG, mergeConfig } from "../../src/shared/config.js";
import type { ApiRoleRequest } from "../../src/shared/llm/api-role-runner.js";
import { runDraft } from "../../src/spec-stage/application/draft.js";
import type { StageClock } from "../../src/spec-stage/application/stage-clock.js";
import { collectingContext, fakeCommandRunner, NO_SIMPLE_FIXES_CONFIG, runState, scriptedApiRoles, sliceContext as assemblySliceContext, taskState, tempDir } from "../assembly-stage/support.js";
import { runLaneEffect } from "../build-stage/support/lanes.js";
import { TEST_CONFIG } from "../build-stage/support/harness.js";
import { verifiedLane, writeReview } from "../build-stage/support/reviews.js";
import { reviewFrontmatter, scriptedApiRoles as scriptedLaneRoles } from "../build-stage/support/runners.js";
import { ARCHITECT_HANDOFF_LINES, handoffPathIn, handoffText, harness, stateIn, techMdText, writeVia } from "../design-stage/harness.js";
import { analystHandoff, CLI_SPEC, effectContext, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext as specSliceContext, stageWorkspace, writeText } from "../spec-stage/harness.js";

function idleClock(): StageClock {
  return { start: () => undefined, stop: () => undefined };
}

async function architectCompleting(request: ApiRoleRequest): Promise<void> {
  await writeVia(request, "design/tech.md", techMdText());
  await writeVia(request, handoffPathIn(request), handoffText("architect", 1, ARCHITECT_HANDOFF_LINES));
}

function reviewApproving(request: ApiRoleRequest): Promise<void> {
  const implSha = /Reviewed commit: ([0-9a-f]{40})/.exec(request.message)?.[1] ?? null;
  return writeReview(request, reviewFrontmatter({ impl_sha: implSha }));
}

describe("configured API role time budget", () => {
  // @covers factory:DLT-015
  it("runs the spec analyst with the configured apiRoleMs as its time budget", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => writeText(join(ws.handoffsDir, "spec-analyst", "handoff.md"), analystHandoff(1))]);
    const config = mergeConfig(DEFAULT_CONFIG, { timeouts: { apiRoleMs: 1_800_000 } });
    const { context } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, specSliceContext(ws, roles, config), { commands: scriptedCommands(sddReplies({})), clock: idleClock() });

    expect(roles.requests.map((request) => request.timeoutMs)).toEqual([1_800_000]);
  });

  // @covers factory:DLT-015
  it("runs the architect with the configured apiRoleMs as its time budget", async () => {
    const h = await harness({ scripts: { architect: [architectCompleting] } });
    const slice = { ...h.slice, config: mergeConfig(h.slice.config, { timeouts: { apiRoleMs: 1_800_000 } }) };

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), slice);

    expect(h.roleCalls.map((request) => request.timeoutMs)).toEqual([1_800_000]);
  });

  // @covers factory:DLT-015
  it("runs the reviewer with the configured apiRoleMs as its time budget", async () => {
    const apiRoles = scriptedLaneRoles(reviewApproving);
    const { harness: lane, state } = await verifiedLane(apiRoles, mergeConfig(TEST_CONFIG, { timeouts: { apiRoleMs: 1_800_000 } }));

    await runLaneEffect(lane, "build.reviewer", { taskId: "T-001", mode: "review", attempt: 1 }, state);

    expect(apiRoles.requests.map((request) => request.timeoutMs)).toEqual([1_800_000]);
  });

  // @covers factory:DLT-015
  it("runs triage with the configured apiRoleMs as its time budget", async () => {
    const root = await tempDir("configured-api-timeout");
    const apiRoles = scriptedApiRoles(async () => "---\nrole: triage\nattempt: 1\nstatus: complete\nroute:\n  task_id: null\n  target: planner\n  reason: unknown\n---\nno match\n");
    const config = mergeConfig(NO_SIMPLE_FIXES_CONFIG, { timeouts: { apiRoleMs: 1_800_000 } });
    const context = collectingContext(runState({ status: "building", assemblyRounds: 1, tasks: { "T-001": taskState({}) } }));

    await triageEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath: join(root, "run/handoffs/assembly/round-1/typecheck.log") }, context, assemblySliceContext({ root, apiRoles, config }));

    expect(apiRoles.requests.map((request) => request.timeoutMs)).toEqual([1_800_000]);
  });
});
