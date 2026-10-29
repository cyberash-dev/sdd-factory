import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness, type LaneHarness } from "./support/harness.js";
import { GREEN_IMPL, laneState, provisionLane, RED_TEST, runLaneEffect, type ProvisionedLane } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import type { RunState } from "../../src/bus/domain/run-state.js";

interface FrozenLane {
  readonly harness: LaneHarness;
  readonly lane: ProvisionedLane;
  readonly testsSha: string;
  readonly state: RunState;
}

async function frozenLane(implementerFiles: Readonly<Record<string, string>>): Promise<FrozenLane> {
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
  const lane = await provisionLane(harness);
  await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
  await git(lane.worktree, ["add", "-A"]);
  await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
  const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
  for (const [path, content] of Object.entries(implementerFiles)) {
    await writeProductFile(lane.worktree, path, content);
  }
  return { harness, lane, testsSha, state: laneState(lane, { status: "verify_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha }) };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("green check on a real worktree", () => {
  // @covers build-stage:BEH-006
  it("commits a green implementation and reports implSha equal to the new head", async () => {
    const { harness, lane, testsSha, state } = await frozenLane({ "src/greet.ts": GREEN_IMPL });

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, state);

    const head = await git(lane.worktree, ["rev-parse", "HEAD"]);
    expect([published, head === testsSha, await git(lane.worktree, ["log", "-1", "--format=%s"])]).toEqual([
      [{ type: "task.verified", producer: "foreman", payload: { taskId: "T-001", result: "green", evidencePath: join(harness.context.paths.handoffsDir, "tasks", "T-001", "verifier-green-1.json"), testsUnchanged: true, writeSetOk: true, implSha: head } }],
      false,
      "impl T-001 attempt 1",
    ]);
  });

  it("reports red with both flags true when a test still fails and commits nothing", async () => {
    const { harness, lane, testsSha, state } = await frozenLane({ "src/greet.ts": "export function greet(name: string): string {\n  return name;\n}\n" });

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, state);

    expect([published.map((event) => [event.payload["result"], event.payload["testsUnchanged"], event.payload["writeSetOk"], event.payload["implSha"]]), await git(lane.worktree, ["rev-parse", "HEAD"])]).toEqual([[["red", true, true, null]], testsSha]);
  });

  it("reports red on a typecheck error", async () => {
    const { harness, state } = await frozenLane({ "src/greet.ts": 'export function greet(name: string): string {\n  const typed: number = "not a number";\n  return `Hello, ${name}!${typed === 0 ? "" : ""}`;\n}\n' });

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, state);

    const written: unknown = JSON.parse(await readFile(String(published[0]?.payload["evidencePath"]), "utf8"));
    expect([published[0]?.payload["result"], typeof written === "object" && written !== null && "reasons" in written ? written.reasons : null]).toEqual(["red", ["typecheck"]]);
  });

  // @covers build-stage:INV-001
  it("restores an edited frozen test from testsSha and reports testsUnchanged false", async () => {
    const { harness, lane, state } = await frozenLane({ "src/greet.ts": GREEN_IMPL, "tests/greet.test.ts": RED_TEST.replace('"Hello, Ada!"', '"Hello, Bob!"') });

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, state);

    expect([published.map((event) => [event.payload["result"], event.payload["testsUnchanged"]]), await readFile(join(lane.worktree, "tests/greet.test.ts"), "utf8")]).toEqual([[["red", false]], RED_TEST]);
  });

  // @covers build-stage:INV-002
  it("deletes a file created outside the write-set and reports writeSetOk false", async () => {
    const { harness, lane, state } = await frozenLane({ "src/greet.ts": GREEN_IMPL, "src/other/file.ts": "export const x = 1;\n" });

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, state);

    expect([published.map((event) => [event.payload["result"], event.payload["writeSetOk"]]), await exists(join(lane.worktree, "src/other/file.ts"))]).toEqual([[["red", false]], false]);
  });

  it("deletes a test file added by the implementer before rework", async () => {
    const { harness, lane, state } = await frozenLane({ "src/greet.ts": GREEN_IMPL, "tests/extra.test.ts": 'import { it } from "vitest";\nit("x", () => undefined);\n' });

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, state);

    expect([published.map((event) => event.payload["writeSetOk"]), await exists(join(lane.worktree, "tests/extra.test.ts"))]).toEqual([[false], false]);
  });

  it("reverts a modified file outside the write-set to its frozen content", async () => {
    const { harness, lane, state } = await frozenLane({ "src/greet.ts": GREEN_IMPL, "package.json": "{}\n" });

    await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, state);

    expect(JSON.parse(await readFile(join(lane.worktree, "package.json"), "utf8"))).toEqual({ name: "greeter", type: "module", private: true });
  });
});
