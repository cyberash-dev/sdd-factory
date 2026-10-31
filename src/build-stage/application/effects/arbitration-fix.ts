import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { fixScopeOf, runSimpleFix } from "../../../shared/fixer/index.js";
import type { SliceContext } from "../../../shared/slice.js";
import { laneHandoffPath } from "../../domain/handoff-paths.js";
import type { ReworkFinding } from "../../domain/rules/support.js";
import { errorText, fixerDeps, type LaneDeps } from "../lane-deps.js";
import { findingReportOf, taskStateOf } from "../lane-inputs.js";

export interface ArbitrationFixRun {
  readonly taskId: string;
  readonly frozenTestsSha: string;
  readonly reworkFinding: ReworkFinding;
}

function publishCapExhausted(context: EffectContext, taskId: string): void {
  context.publish({ type: "task.failed", producer: "foreman", payload: { taskId, reason: "cap_exhausted", detail: "test-writer" } });
}

/* build-stage:DLT-016: the simple-fixer edits the frozen tests the arbitration report names; once fixed, the red check runs as if the test-writer had finished. */
export async function runArbitrationFix(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: ArbitrationFixRun): Promise<void> {
  deps.lanes.cancel(run.taskId);
  const token = deps.lanes.tokenOf(run.taskId);
  const task = taskStateOf(context.state, run.taskId);
  /* The review report is untracked in the worktree, so the clean below removes it. */
  const report = await findingReportOf(run.reworkFinding, task.worktree);
  if (report === null) {
    slice.log(`arbitration fix ${run.taskId}: report ${run.reworkFinding.findingPath ?? "(none)"} unreadable`);
    publishCapExhausted(context, run.taskId);
    return;
  }
  try {
    await deps.git.resetHard(task.worktree, run.frozenTestsSha);
    await deps.git.cleanUntracked(task.worktree);
  } catch (error) {
    context.publish({ type: "task.failed", producer: "foreman", payload: { taskId: run.taskId, reason: "blocked", detail: `worktree_error: ${errorText(error)}` } });
    return;
  }
  const result = await runSimpleFix(slice, fixerDeps(deps), context, {
    trigger: "arbitration_tests",
    owner: "test-writer",
    unit: run.taskId,
    taskId: run.taskId,
    directory: task.worktree,
    scope: fixScopeOf({ trigger: "arbitration_tests", writes: task.writes }),
    formatOnly: [],
    failureOutput: report,
    check: async () => ({ passed: (await deps.git.changedFiles(task.worktree)).length > 0, output: report }),
  });
  slice.log(`arbitration fix ${run.taskId}: simple-fixer ${result.verdict} after ${result.runs.length} run(s)`);
  const lastRun = result.runs.at(-1);
  if (result.verdict === "terminated" || !deps.lanes.isLive(token)) {
    return;
  }
  if (result.verdict !== "fixed" || lastRun === undefined) {
    publishCapExhausted(context, run.taskId);
    return;
  }
  const lastTestWriterAttempt = task.attempts.testWriter;
  /* bus:BEH-002 dedupes task.tests_written on taskId and attempt: the last test-writer attempt is consumed, a fixer attempt number never repeats.
     The fixer's cost is already on its fix.attempted. */
  context.publish({
    type: "task.tests_written",
    producer: "foreman",
    payload: {
      taskId: run.taskId,
      attempt: lastTestWriterAttempt + lastRun.attempt,
      handoffPath: laneHandoffPath(slice.paths.handoffsDir, run.taskId, "test-writer", lastTestWriterAttempt),
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      firewallViolations: [],
    },
  });
}
