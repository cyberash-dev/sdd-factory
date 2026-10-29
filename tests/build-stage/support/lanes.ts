import { dirname, join } from "node:path";
import type { RunState, TaskState } from "../../../src/bus/domain/run-state.js";
import type { PendingEvent } from "../../../src/bus/domain/transition.js";
import { laneHandoffPath, type LaneRole } from "../../../src/build-stage/domain/handoff-paths.js";
import type { LaneHarness } from "./harness.js";
import { aTask, buildingState } from "./state.js";

export interface ProvisionedLane {
  readonly worktree: string;
  readonly baseSha: string;
  readonly ready: PendingEvent;
}

export async function provisionLane(harness: LaneHarness, taskId = "T-001"): Promise<ProvisionedLane> {
  const published: PendingEvent[] = [];
  const handler = harness.slice.effects["build.worktree"];
  if (handler === undefined) {
    throw new Error("build.worktree handler missing");
  }
  await handler({ kind: "build.worktree", taskId }, harness.effectContext(buildingState({ [taskId]: aTask() }), published), harness.context);
  const ready = published[0];
  if (ready === undefined || ready.type !== "task.ready") {
    throw new Error(`lane start published ${JSON.stringify(published)}`);
  }
  return { worktree: String(ready.payload["worktree"]), baseSha: String(ready.payload["baseSha"]), ready };
}

export function laneState(lane: ProvisionedLane, overrides: Partial<TaskState> = {}, taskId = "T-001"): RunState {
  return buildingState({ [taskId]: aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 1 }, worktree: lane.worktree, baseSha: lane.baseSha, ...overrides }) });
}

export async function runLaneEffect(harness: LaneHarness, kind: string, fields: Readonly<Record<string, unknown>>, state: RunState): Promise<PendingEvent[]> {
  const published: PendingEvent[] = [];
  const handler = harness.slice.effects[kind];
  if (handler === undefined) {
    throw new Error(`${kind} handler missing`);
  }
  await handler({ kind, ...fields }, harness.effectContext(state, published), harness.context);
  return published;
}

export function handoffPathOf(harness: LaneHarness, role: LaneRole, attempt: number, taskId = "T-001"): string {
  return laneHandoffPath(harness.context.paths.handoffsDir, taskId, role, attempt);
}

/* The worktree lives at <runDir>/worktrees/<taskId>, so the run's handoff dir is two levels up. */
export function handoffPathFromWorktree(worktree: string, role: LaneRole, attempt: number, taskId = "T-001"): string {
  return laneHandoffPath(join(dirname(dirname(worktree)), "handoffs"), taskId, role, attempt);
}

/* Composed so the sdd marker scanner does not read fixture markers as this partition's own obligations. */
export function coversMarker(id: string): string {
  return `// @${"covers"} ${id}`;
}

export const RED_TEST = `import { expect, it } from "vitest";
import { greet } from "../src/greet.js";

${coversMarker("greeter:BEH-001")}
it("greets by name", () => {
  expect(greet("Ada")).toBe("Hello, Ada!");
});
`;

export const GREEN_IMPL = `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;
