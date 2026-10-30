import { signalLanes } from "../../../shared/llm/cli-role-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import type { LaneDeps } from "../lane-deps.js";

/* build-stage:BEH-016: subprocesses get SIGTERM and keep their partial state in the worktree; a lane that still returns is dropped. */
export async function runTerminateLanes(slice: SliceContext, deps: LaneDeps): Promise<void> {
  deps.lanes.cancelAll();
  signalLanes("SIGTERM");
  slice.log("lanes terminated: running claude subprocesses got SIGTERM; their late results are dropped");
}
