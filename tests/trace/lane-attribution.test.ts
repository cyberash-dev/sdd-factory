import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness, happyPath, runUntilDesign, SHA, tasksJson, type Harness } from "./scripted-factory.js";

interface CostsFile {
  readonly entries: readonly { participant: string; taskId: string | null; costUsd: number | null }[];
}

async function twoGreenLanes(harness: Harness): Promise<void> {
  await runUntilDesign(harness);
  await mkdir(join(harness.productDir, "design"), { recursive: true });
  await writeFile(join(harness.productDir, "design", "tasks.json"), tasksJson({ "T-001": "Domain model", "T-002": "CLI entry" }), "utf8");
  await harness.publish("design.tasks.ready", "planner", { path: "design/tasks.json", taskCount: 2 });
  for (const taskId of ["T-001", "T-002"]) {
    await harness.publish("task.ready", "foreman", { taskId, worktree: `/wt/${taskId}`, baseSha: SHA, covers: [], writes: [] });
    await harness.publish("task.verified", "foreman", { taskId, result: "green", evidencePath: "verifier.json", testsUnchanged: true, writeSetOk: true });
  }
}

async function reviewerEntries(harness: Harness): Promise<CostsFile["entries"]> {
  await harness.publish("task.approved", "foreman", { taskId: "T-001", implSha: SHA });
  const costs: CostsFile = JSON.parse(await readFile(join(harness.traceDir, "costs.json"), "utf8"));
  return costs.entries.filter((entry) => entry.participant === "reviewer");
}

describe("API role cost attribution to a task lane", () => {
  // @covers trace:BEH-004
  it("attributes a reviewer inference to the task named by the agent's task capability, not to the oldest green task", async () => {
    const harness = await createHarness();
    await twoGreenLanes(harness);

    await harness.infer("reviewer", "m", { inputTokens: 1000, outputTokens: 200 }, "T-002");

    expect((await reviewerEntries(harness)).map((entry) => [entry.taskId, entry.costUsd])).toEqual([["T-002", 0.006]]);
  });

  // @covers trace:BEH-004
  it("falls back to the oldest green-verified task for a reviewer agent without a task capability", async () => {
    const harness = await createHarness();
    await twoGreenLanes(harness);

    await harness.infer("reviewer", "m", { inputTokens: 1000, outputTokens: 200 });

    expect((await reviewerEntries(harness)).map((entry) => entry.taskId)).toEqual(["T-001"]);
  });

  it("keeps stage roles without a task capability at taskId null", async () => {
    const harness = await createHarness();

    await happyPath(harness);

    const costs: CostsFile = JSON.parse(await readFile(join(harness.traceDir, "costs.json"), "utf8"));
    expect(costs.entries.filter((entry) => entry.participant === "architect").map((entry) => entry.taskId)).toEqual([null]);
  });
});
