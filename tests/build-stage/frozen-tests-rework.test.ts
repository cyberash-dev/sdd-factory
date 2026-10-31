import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskState } from "../../src/bus/domain/run-state.js";
import { reduce, type PendingEvent } from "../../src/bus/domain/transition.js";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness, type LaneHarness } from "./support/harness.js";
import { coversMarker, GREEN_IMPL, laneState, provisionLane, RED_TEST, runLaneEffect, type ProvisionedLane } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { scriptedCliRoles, type ScriptedCliRoles } from "./support/runners.js";
import { delivered } from "./support/state.js";

const REVIEW_REPORT = "# Review T-001\n\ntests/greet.test.ts:5 expects `Hello, Ada!` but greeter:BEH-001 names `Hi, Ada`.\n";

interface FrozenLane {
  readonly harness: LaneHarness;
  readonly lane: ProvisionedLane;
  readonly testsSha: string;
  readonly cliRoles: ScriptedCliRoles;
}

async function aLaneWithFrozenTestsAndASourceChange(): Promise<FrozenLane> {
  const cliRoles = scriptedCliRoles(() => undefined);
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
  const lane = await provisionLane(harness);
  await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
  await git(lane.worktree, ["add", "-A"]);
  await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
  const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
  await writeProductFile(lane.worktree, "src/greet.ts", GREEN_IMPL);
  await writeProductFile(lane.worktree, "reviews/T-001.md", REVIEW_REPORT);
  return { harness, lane, testsSha, cliRoles };
}

async function reworkTestWriter(frozen: FrozenLane, reason: string, testsSha: string | null): Promise<void> {
  const state = laneState(frozen.lane, { status: "review_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha, implSha: null });
  const outcome = reduce(frozen.harness.slice.rules, state, delivered("task.rework", { taskId: "T-001", target: "test-writer", attempt: 2, reason, findingPath: "reviews/T-001.md" }), new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  const published: PendingEvent[] = [];
  for (const effect of outcome.result.effects) {
    await frozen.harness.slice.effects[effect.kind]?.(effect, frozen.harness.effectContext(outcome.result.state, published), frozen.harness.context);
  }
}

async function worktreeSnapshot(worktree: string): Promise<readonly string[]> {
  return [await git(worktree, ["rev-parse", "HEAD"]), await git(worktree, ["status", "--porcelain"]), await git(worktree, ["ls-files", "tests"])];
}

const FAREWELL_TEST = `import { expect, it } from "vitest";
import { greet } from "../src/greet.js";

${coversMarker("greeter:BEH-002")}
it("greets a second name", () => {
  expect(greet("Bob")).toBe("Hello, Bob!");
});
`;

function twoFileTask(): Partial<TaskState> {
  return { covers: ["greeter:BEH-001", "greeter:BEH-002"], writes: ["src/greet.ts", "tests/greet.test.ts", "tests/farewell.test.ts"] };
}

describe("finding-routed test-writer rework on frozen tests", () => {
  // @covers build-stage:DLT-015
  it("resets a test_contract_conflict rework to the frozen tests commit with the tests present and the source change gone", async () => {
    const frozen = await aLaneWithFrozenTestsAndASourceChange();

    await reworkTestWriter(frozen, "test_contract_conflict", frozen.testsSha);

    expect(await worktreeSnapshot(frozen.lane.worktree)).toEqual([frozen.testsSha, "", "tests/greet.test.ts"]);
  });

  // @covers build-stage:DLT-015
  it("names the finding to the reworked test-writer and states that its frozen tests are in place", async () => {
    const frozen = await aLaneWithFrozenTestsAndASourceChange();

    await reworkTestWriter(frozen, "test_contract_conflict", frozen.testsSha);

    const prompt = frozen.cliRoles.requests[0]?.prompt ?? "";
    expect([prompt.includes("test_contract_conflict"), prompt.includes("greeter:BEH-001 names `Hi, Ada`"), prompt.includes("Your frozen tests are in place")]).toEqual([true, true, true]);
  });

  // @covers build-stage:DLT-015
  it("resets a design restart to baseSha even when the task has frozen tests", async () => {
    const frozen = await aLaneWithFrozenTestsAndASourceChange();

    await reworkTestWriter(frozen, "architect_repair: greeter:BEH-001", frozen.testsSha);

    expect(await worktreeSnapshot(frozen.lane.worktree)).toEqual([frozen.lane.baseSha, "", ""]);
  });

  // @covers build-stage:DLT-015
  it("resets a rework of a task whose red check never passed to baseSha", async () => {
    const frozen = await aLaneWithFrozenTestsAndASourceChange();

    await reworkTestWriter(frozen, "review_changes", null);

    expect(await worktreeSnapshot(frozen.lane.worktree)).toEqual([frozen.lane.baseSha, "", ""]);
  });

  // @covers build-stage:DLT-015
  it("passes the red check after the test-writer edited one of two frozen test files, finding the covers of both", async () => {
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
    const lane = await provisionLane(harness);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
    await writeProductFile(lane.worktree, "tests/farewell.test.ts", FAREWELL_TEST);
    await git(lane.worktree, ["add", "-A"]);
    await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST.replace("Hello, Ada!", "Hi, Ada"));

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 2, firewallViolations: [] }, laneState(lane, { attempts: { implementer: 1, testWriter: 2 }, ...twoFileTask() }));

    const head = await git(lane.worktree, ["rev-parse", "HEAD"]);
    expect([published, await readFile(join(lane.worktree, "tests/greet.test.ts"), "utf8")]).toEqual([
      [{ type: "task.tests_red", producer: "foreman", payload: { taskId: "T-001", testsSha: head, testFiles: ["tests/farewell.test.ts", "tests/greet.test.ts"] } }],
      RED_TEST.replace("Hello, Ada!", "Hi, Ada"),
    ]);
  });
});
