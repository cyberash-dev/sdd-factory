import { describe, expect, it } from "vitest";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { aTask, buildingState, IMPL_SHA } from "./support/state.js";

async function aProductWithConflictingTaskBranch(): Promise<string> {
  const productDir = await aProductRepo({ "src/greet.ts": "export const greeting = 'base';\n" });
  await git(productDir, ["checkout", "-q", "-b", "task/T-001"]);
  await writeProductFile(productDir, "src/greet.ts", "export const greeting = 'task';\n");
  await git(productDir, ["commit", "-q", "-am", "task change"]);
  await git(productDir, ["checkout", "-q", "integration"]);
  await writeProductFile(productDir, "src/greet.ts", "export const greeting = 'integration';\n");
  await git(productDir, ["commit", "-q", "-am", "integration change"]);
  return productDir;
}

async function aProductWithTaskBranch(): Promise<string> {
  const productDir = await aProductRepo({ "src/greet.ts": "export const greeting = 'base';\n" });
  await git(productDir, ["checkout", "-q", "-b", "task/T-001"]);
  await writeProductFile(productDir, "src/greet.ts", "export const greeting = 'task';\n");
  await git(productDir, ["commit", "-q", "-am", "task change"]);
  await git(productDir, ["checkout", "-q", "integration"]);
  return productDir;
}

describe("integration of an approved lane", () => {
  // @covers build-stage:DLT-008
  // @covers build-stage:BEH-009
  it("routes a merge conflict found before any assembly round straight to the planner", async () => {
    const productDir = await aProductWithConflictingTaskBranch();
    const harness = await aLaneHarness({ productDir, design: greeterDesign() });
    const state = buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 1, testWriter: 1 }, implSha: IMPL_SHA, worktree: productDir }) });
    const published: PendingEvent[] = [];

    await harness.slice.effects["build.integrate"]?.({ kind: "build.integrate", taskId: "T-001" }, harness.effectContext(state, published), harness.context);

    expect(published).toEqual([{ type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "planner", attempt: 1, reason: "write_set_conflict", findingPath: null } }]);
  });

  // @covers build-stage:DLT-004
  it("approves a task whose review is advisory_only without a report file in the worktree", async () => {
    const productDir = await aProductWithTaskBranch();
    const harness = await aLaneHarness({ productDir, design: greeterDesign() });
    const state = buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 1, testWriter: 1 }, implSha: IMPL_SHA, worktree: productDir }) });
    const published: PendingEvent[] = [];

    await harness.slice.effects["build.integrate"]?.({ kind: "build.integrate", taskId: "T-001" }, harness.effectContext(state, published), harness.context);

    expect(published).toEqual([{ type: "task.approved", producer: "foreman", payload: { taskId: "T-001", implSha: IMPL_SHA } }]);
  });
});
