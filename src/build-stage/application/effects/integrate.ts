import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { reviewReportPath, taskBranch } from "../../domain/handoff-paths.js";
import { plannerRework } from "../../domain/rules/support.js";
import type { LaneDeps } from "../lane-deps.js";
import { requireSha, taskStateOf } from "../lane-inputs.js";

export const INTEGRATION_BRANCH = "integration";
const WRITE_SET_CONFLICT = "write_set_conflict";

/* The report lands on integration after the merge so the task branch head stays the verified implSha. */
async function publishReview(slice: SliceContext, deps: LaneDeps, worktree: string, taskId: string): Promise<void> {
  const report = reviewReportPath(taskId);
  const target = join(slice.paths.productDir, report);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(worktree, report), target, { force: true });
  await deps.git.commitPaths(slice.paths.productDir, [report], `review ${taskId}`);
}

/* assembly.rework carries round >= 1, so a conflict before the first assembly round cannot go through assembly triage. */
function publishConflict(slice: SliceContext, context: EffectContext, taskId: string): void {
  if (context.state.stageAttempts.assemblyRounds === 0) {
    context.publish(plannerRework(context.state, taskId, slice.config.caps, WRITE_SET_CONFLICT, null));
    return;
  }
  context.publish({ type: "assembly.triaged", producer: "foreman", payload: { taskId, target: "planner", reason: WRITE_SET_CONFLICT } });
}

export async function runIntegrate(slice: SliceContext, deps: LaneDeps, context: EffectContext, taskId: string, capReachedRole: string | null): Promise<void> {
  const task = taskStateOf(context.state, taskId);
  const implSha = requireSha(task.implSha, "implSha");
  await deps.git.checkout(slice.paths.productDir, INTEGRATION_BRANCH);
  const outcome = await deps.git.merge(slice.paths.productDir, taskBranch(taskId), `merge ${taskId}`);
  if (outcome === "conflict") {
    publishConflict(slice, context, taskId);
    return;
  }
  await publishReview(slice, deps, task.worktree, taskId);
  if (capReachedRole !== null) {
    slice.log(`${taskId} approved on green evidence: ${capReachedRole} cap reached, review findings kept as advisory`);
  }
  context.publish({ type: "task.approved", producer: "foreman", payload: { taskId, implSha } });
}
