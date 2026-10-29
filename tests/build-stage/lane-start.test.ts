import { readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aModule, aTaskSpec, greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { provisionLane, runLaneEffect } from "./support/lanes.js";
import { aProductRepo, git } from "./support/product.js";
import { aTask, buildingState } from "./support/state.js";

describe("lane start", () => {
  // @covers build-stage:BEH-001
  it("creates the task worktree on its own branch from integration, links node_modules, scaffolds a throwing stub and reports the scaffold commit as baseSha", async () => {
    const productDir = await aProductRepo();
    const harness = await aLaneHarness({ productDir, design: greeterDesign() });

    const lane = await provisionLane(harness);

    const stub = await readFile(join(lane.worktree, "src/greet.ts"), "utf8");
    expect([
      await git(lane.worktree, ["rev-parse", "--abbrev-ref", "HEAD"]),
      await git(lane.worktree, ["log", "-1", "--format=%s"]),
      lane.baseSha === (await git(lane.worktree, ["rev-parse", "HEAD"])),
      await readlink(join(lane.worktree, "node_modules")),
      stub,
      lane.ready.payload,
    ]).toEqual([
      "task/T-001",
      "scaffold T-001",
      true,
      join(productDir, "node_modules"),
      'export function greet(name: string): string {\n  throw new Error("not implemented: greet");\n}\n',
      { taskId: "T-001", worktree: lane.worktree, baseSha: lane.baseSha, covers: ["greeter:BEH-001"], writes: ["src/greet.ts", "tests/greet.test.ts"] },
    ]);
  });

  it("does not overwrite a module path that already exists on integration", async () => {
    const productDir = await aProductRepo({ "src/greet.ts": "export function greet(name: string): string {\n  return name;\n}\n" });
    const harness = await aLaneHarness({ productDir, design: greeterDesign() });

    const lane = await provisionLane(harness);

    expect([await readFile(join(lane.worktree, "src/greet.ts"), "utf8"), await git(lane.worktree, ["log", "-1", "--format=%s"])]).toEqual(["export function greet(name: string): string {\n  return name;\n}\n", "scaffold product"]);
  });

  it("writes an empty module for owned non-entry paths and the stub only for the entry", async () => {
    const module = aModule({ owns: ["src/greet.ts", "src/greet/format.ts"] });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign([aTaskSpec()], [module]) });

    const lane = await provisionLane(harness);

    expect(await readFile(join(lane.worktree, "src/greet/format.ts"), "utf8")).toBe("export {};\n");
  });

  it("schedules only the tasks without pending dependencies, up to maxParallelLanes", async () => {
    const design = greeterDesign([aTaskSpec({ id: "T-001" }), aTaskSpec({ id: "T-002", writes: ["src/b.ts", "tests/b.test.ts"], designRefs: [] }), aTaskSpec({ id: "T-003", dependsOn: ["T-001"], designRefs: [] })]);
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design, config: { maxParallelLanes: 4 } });
    const state = buildingState({ "T-001": aTask(), "T-002": aTask({ writes: ["src/b.ts", "tests/b.test.ts"] }), "T-003": aTask({ dependsOn: ["T-001"] }) });

    const published = await runLaneEffect(harness, "build.schedule", {}, state);

    expect(published.map((event) => [event.type, event.payload["taskId"]])).toEqual([
      ["task.ready", "T-001"],
      ["task.ready", "T-002"],
    ]);
  });

  it("starts a dependent task from the integration head that contains the merged dependency", async () => {
    const productDir = await aProductRepo();
    const design = greeterDesign([aTaskSpec({ id: "T-001" }), aTaskSpec({ id: "T-002", dependsOn: ["T-001"], designRefs: [] })]);
    const harness = await aLaneHarness({ productDir, design });
    await git(productDir, ["commit", "-q", "--allow-empty", "-m", "merge T-001"]);
    const mergedSha = await git(productDir, ["rev-parse", "HEAD"]);
    const state = buildingState({ "T-001": aTask({ status: "approved", implSha: mergedSha }), "T-002": aTask({ dependsOn: ["T-001"] }) });

    const published = await runLaneEffect(harness, "build.schedule", {}, state);

    const baseSha = String(published[0]?.payload["baseSha"]);
    expect([published.map((event) => event.payload["taskId"]), await git(productDir, ["merge-base", "--is-ancestor", mergedSha, baseSha]).then(() => "ancestor")]).toEqual([["T-002"], "ancestor"]);
  });

  it("never starts a task whose dependency failed", async () => {
    const design = greeterDesign([aTaskSpec({ id: "T-001" }), aTaskSpec({ id: "T-002", dependsOn: ["T-001"], designRefs: [] })]);
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design });
    const state = buildingState({ "T-001": aTask({ status: "failed" }), "T-002": aTask({ dependsOn: ["T-001"] }) });

    const published = await runLaneEffect(harness, "build.schedule", {}, state);

    expect(published).toEqual([]);
  });

  it("reports a git failure as task.failed with reason blocked and worktree_error detail", async () => {
    const harness = await aLaneHarness({ productDir: "/nonexistent/product", design: greeterDesign() });

    const published = await runLaneEffect(harness, "build.worktree", { taskId: "T-001" }, buildingState({ "T-001": aTask() }));

    expect(published.map((event) => [event.type, event.payload["reason"], String(event.payload["detail"]).startsWith("worktree_error:")])).toEqual([["task.failed", "blocked", true]]);
  });

  it("recreates an existing worktree when a task is scheduled again", async () => {
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
    const first = await provisionLane(harness);

    const second = await provisionLane(harness);

    expect([second.worktree, await git(second.worktree, ["log", "-1", "--format=%s"])]).toEqual([first.worktree, "scaffold T-001"]);
  });
});
