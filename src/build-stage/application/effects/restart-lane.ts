import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { frozenTestsFinding } from "../../domain/lane-messages.js";
import type { ReworkFinding } from "../../domain/rules/support.js";
import { errorText, type LaneDeps } from "../lane-deps.js";
import { requireSha, reworkFindingText, taskStateOf } from "../lane-inputs.js";
import { runTestWriterOnFinding } from "./test-writer.js";

export interface RestartLaneRun {
  readonly taskId: string;
  readonly attempt: number;
  readonly reworkFinding: ReworkFinding | null;
  readonly frozenTestsSha: string | null;
}

/* build-stage:BEH-004, DLT-015: back to the frozen tests or to baseSha, untracked files gone, then the test-writer again with the finding and the current design (design-stage:BEH-004). */
export async function runRestartLane(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: RestartLaneRun): Promise<void> {
  deps.lanes.cancel(run.taskId);
  const task = taskStateOf(context.state, run.taskId);
  /* The review report is untracked in the worktree, so the clean below removes it. */
  const findingText = await reworkFindingText(run.reworkFinding, task.worktree);
  try {
    await deps.git.resetHard(task.worktree, run.frozenTestsSha ?? requireSha(task.baseSha, "baseSha"));
    await deps.git.cleanUntracked(task.worktree);
  } catch (error) {
    context.publish({ type: "task.failed", producer: "foreman", payload: { taskId: run.taskId, reason: "blocked", detail: `worktree_error: ${errorText(error)}` } });
    return;
  }
  await deps.design.reload();
  await runTestWriterOnFinding(slice, deps, context, run, findingText === null || run.frozenTestsSha === null ? findingText : frozenTestsFinding(findingText));
}
