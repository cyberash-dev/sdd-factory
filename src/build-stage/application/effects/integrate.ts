import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { reviewReportPath, taskBranch } from "../../domain/handoff-paths.js";
import type { LaneDeps } from "../lane-deps.js";
import { requireSha, taskStateOf } from "../lane-inputs.js";

export const INTEGRATION_BRANCH = "integration";

/* The report lands on integration after the merge so the task branch head stays the verified implSha. */
async function publishReview(slice: SliceContext, deps: LaneDeps, worktree: string, taskId: string): Promise<void> {
  const report = reviewReportPath(taskId);
  const target = join(slice.paths.productDir, report);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(worktree, report), target, { force: true });
  await deps.git.commitPaths(slice.paths.productDir, [report], `review ${taskId}`);
}

export async function runIntegrate(slice: SliceContext, deps: LaneDeps, context: EffectContext, taskId: string): Promise<void> {
  const task = taskStateOf(context.state, taskId);
  const implSha = requireSha(task.implSha, "implSha");
  await deps.git.checkout(slice.paths.productDir, INTEGRATION_BRANCH);
  const outcome = await deps.git.merge(slice.paths.productDir, taskBranch(taskId), `merge ${taskId}`);
  if (outcome === "conflict") {
    context.publish({ type: "assembly.triaged", producer: "foreman", payload: { taskId, target: "planner", reason: "write_set_conflict" } });
    return;
  }
  await publishReview(slice, deps, task.worktree, taskId);
  context.publish({ type: "task.approved", producer: "foreman", payload: { taskId, implSha } });
}
