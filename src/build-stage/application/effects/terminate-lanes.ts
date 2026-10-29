import type { SliceContext } from "../../../shared/slice.js";
import type { LaneDeps } from "../lane-deps.js";

/* Kernel gap: CliRoleRunner exposes no kill handle, so termination means dropping every late lane result. */
export async function runTerminateLanes(slice: SliceContext, deps: LaneDeps): Promise<void> {
  deps.lanes.cancelAll();
  slice.log("lanes terminated: running claude subprocesses are left to finish; their results are dropped");
}
