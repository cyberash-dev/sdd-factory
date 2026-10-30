import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import type { ReworkFinding } from "../../domain/rules/support.js";
import { errorText, type LaneDeps } from "../lane-deps.js";
import { requireSha, taskStateOf } from "../lane-inputs.js";
import { runTestWriter } from "./test-writer.js";

export interface RestartLaneRun {
  readonly taskId: string;
  readonly attempt: number;
  readonly reworkFinding: ReworkFinding | null;
}

/* build-stage:BEH-004: back to baseSha, untracked files gone, then the test-writer again with the finding and the current design (design-stage:BEH-004). */
export async function runRestartLane(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: RestartLaneRun): Promise<void> {
  deps.lanes.cancel(run.taskId);
  const task = taskStateOf(context.state, run.taskId);
  try {
    await deps.git.resetHard(task.worktree, requireSha(task.baseSha, "baseSha"));
    await deps.git.cleanUntracked(task.worktree);
  } catch (error) {
    context.publish({ type: "task.failed", producer: "foreman", payload: { taskId: run.taskId, reason: "blocked", detail: `worktree_error: ${errorText(error)}` } });
    return;
  }
  await deps.design.reload();
  await runTestWriter(slice, deps, context, run);
}
