import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { greeterDesign } from "../build-stage/support/design.js";
import { aLaneHarness } from "../build-stage/support/harness.js";
import { GREEN_IMPL, laneState, provisionLane, RED_TEST, runLaneEffect } from "../build-stage/support/lanes.js";
import { aProductRepo, git, writeProductFile } from "../build-stage/support/product.js";

describe("write-scope policy is enforced fail-closed by the verifier", () => {
  // @covers factory:POL-002
  it("reverts a test file edited by the implementer and reports the green check red with testsUnchanged false", async () => {
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
    const lane = await provisionLane(harness);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
    await git(lane.worktree, ["add", "-A"]);
    await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
    const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
    await writeProductFile(lane.worktree, "src/greet.ts", GREEN_IMPL);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST.replace('"Hello, Ada!"', '"Hello, Ada"'));

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, laneState(lane, { status: "verify_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha }));

    expect([published.map((event) => [event.type, event.payload["result"], event.payload["testsUnchanged"]]), await readFile(join(lane.worktree, "tests/greet.test.ts"), "utf8")]).toEqual([[["task.verified", "red", false]], RED_TEST]);
  });

  it("rejects test-writer output that lands outside the task write-set and commits nothing", async () => {
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
    const lane = await provisionLane(harness);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
    await writeProductFile(lane.worktree, "src/helper.ts", "export const helper = 1;\n");

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    expect([published.map((event) => [event.type, event.payload["reason"]]), await git(lane.worktree, ["rev-parse", "HEAD"])]).toEqual([[["task.tests_rejected", "outside_write_set"]], lane.baseSha]);
  });
});
