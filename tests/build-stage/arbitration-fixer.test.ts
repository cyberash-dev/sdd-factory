import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type PendingEvent, type ReduceOutcome, type TransitionRule } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness, TEST_CONFIG, type LaneHarness } from "./support/harness.js";
import { GREEN_IMPL, handoffPathOf, laneState, provisionLane, RED_TEST, type ProvisionedLane } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { scriptedCliRoles, type CliScript, type ScriptedCliRoles } from "./support/runners.js";
import { aTask, buildingState, delivered, TESTS_SHA } from "./support/state.js";

const ARBITRATION_REPORT = "# Review T-001 (arbitration)\n\ntests/greet.test.ts:5 expects `Hello, Ada!`; greeter:BEH-001 then-clause names `Hi, Ada`. The test is wrong.\n";

interface ArbitrationLane {
  readonly harness: LaneHarness;
  readonly lane: ProvisionedLane;
  readonly fixer: ScriptedCliRoles;
  readonly state: RunState;
}

type Applied = { readonly state: RunState; readonly emits: readonly PendingEvent[]; readonly effects: readonly Effect[] };

function applied(outcome: ReduceOutcome): Applied {
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function arbitrationRework(rules: readonly TransitionRule[], state: RunState, reason = "test_contract_conflict"): Applied {
  return applied(reduce(rules, state, delivered("task.rework", { taskId: "T-001", target: "test-writer", attempt: 3, reason, findingPath: "reviews/T-001.md" }), new Set()));
}

async function aTaskAtTheTestWriterCap(script: CliScript): Promise<ArbitrationLane> {
  const fixer = scriptedCliRoles(script);
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles: fixer, config: { caps: { ...TEST_CONFIG.caps, simpleFixes: 1 } } });
  const lane = await provisionLane(harness);
  await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
  await git(lane.worktree, ["add", "-A"]);
  await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
  const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
  await writeProductFile(lane.worktree, "src/greet.ts", GREEN_IMPL);
  await writeProductFile(lane.worktree, "reviews/T-001.md", ARBITRATION_REPORT);
  return { harness, lane, fixer, state: laneState(lane, { status: "review_pending", attempts: { implementer: 1, testWriter: 2 }, testsSha, implSha: null }) };
}

async function runEffects(harness: LaneHarness, result: Applied): Promise<PendingEvent[]> {
  const published: PendingEvent[] = [];
  for (const effect of result.effects) {
    await harness.slice.effects[effect.kind]?.(effect, harness.effectContext(result.state, published), harness.context);
  }
  return published;
}

function outcomes(published: readonly PendingEvent[]): readonly unknown[] {
  return published.map((event) => [event.type, event.payload["outcome"] ?? event.payload["reason"], event.payload["detail"] ?? null]);
}

const editTheNamedAssertion: CliScript = async (request) => {
  await writeFile(join(request.cwd, "tests/greet.test.ts"), RED_TEST.replace("Hello, Ada!", "Hi, Ada"), "utf8");
};

describe("arbitration ruling against a frozen test at the test-writer cap", () => {
  // @covers build-stage:DLT-016
  it("starts the simple-fixer with trigger arbitration_tests and the report verbatim instead of failing the task", async () => {
    const { harness, fixer, state } = await aTaskAtTheTestWriterCap(editTheNamedAssertion);

    const rework = arbitrationRework(harness.slice.rules, state);
    await runEffects(harness, rework);

    const prompt = fixer.requests[0]?.prompt ?? "";
    expect([rework.emits, prompt.includes("arbitration_tests"), prompt.includes(ARBITRATION_REPORT.trimEnd())]).toEqual([[], true, true]);
  });

  // @covers build-stage:DLT-016
  it("emits task.tests_written with the last test-writer handoff after the fixer edited a frozen test", async () => {
    const { harness, state } = await aTaskAtTheTestWriterCap(editTheNamedAssertion);

    const published = await runEffects(harness, arbitrationRework(harness.slice.rules, state));

    expect(published.map((event) => [event.type, event.payload["outcome"] ?? event.payload["handoffPath"]])).toEqual([
      ["fix.attempted", "fixed"],
      ["task.tests_written", handoffPathOf(harness, "test-writer", 2)],
    ]);
  });

  // @covers build-stage:DLT-016
  it("keeps the test-writer attempt count and starts the red check on the fixer's task.tests_written", async () => {
    const { harness, state } = await aTaskAtTheTestWriterCap(editTheNamedAssertion);
    const rework = arbitrationRework(harness.slice.rules, state);
    const testsWritten = (await runEffects(harness, rework)).find((event) => event.type === "task.tests_written");

    const next = applied(reduce(harness.slice.rules, rework.state, delivered("task.tests_written", testsWritten?.payload ?? {}, 2), new Set()));

    expect([next.state.tasks["T-001"]?.attempts.testWriter, next.effects.map((effect) => effect.kind)]).toEqual([2, ["build.red-check"]]);
  });

  // @covers build-stage:DLT-016
  it("reverts a fixer edit outside tests/** and fails the task with cap_exhausted test-writer", async () => {
    const { harness, lane, state } = await aTaskAtTheTestWriterCap(async (request) => {
      await writeFile(join(request.cwd, "src/greet.ts"), GREEN_IMPL, "utf8");
    });

    const published = await runEffects(harness, arbitrationRework(harness.slice.rules, state));

    expect([outcomes(published), await git(lane.worktree, ["status", "--porcelain"])]).toEqual([
      [
        ["fix.attempted", "discarded", null],
        ["task.failed", "cap_exhausted", "test-writer"],
      ],
      "",
    ]);
  });

  // @covers build-stage:DLT-016
  it("fails the task with cap_exhausted test-writer when the fixer edits nothing", async () => {
    const { harness, state } = await aTaskAtTheTestWriterCap(() => undefined);

    const published = await runEffects(harness, arbitrationRework(harness.slice.rules, state));

    expect(outcomes(published)).toEqual([
      ["fix.attempted", "unfixed", null],
      ["task.failed", "cap_exhausted", "test-writer"],
    ]);
  });

  // @covers build-stage:DLT-016
  it("fails the task with cap_exhausted test-writer when the test-writer's fixer budget is spent", () => {
    const rules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });
    const state = buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 1, testWriter: 2 }, testsSha: TESTS_SHA }) }, { simpleFixes: { "test-writer:T-001": 2 } });

    const rework = arbitrationRework(rules, state);

    expect([rework.emits, rework.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });

  // @covers build-stage:DLT-016
  it("fails the task with cap_exhausted test-writer for a rework reason other than test_contract_conflict at the cap", () => {
    const rules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });
    const state = buildingState({ "T-001": aTask({ status: "review_pending", attempts: { implementer: 1, testWriter: 2 }, testsSha: TESTS_SHA }) });

    const rework = arbitrationRework(rules, state, "tests_rejected");

    expect([rework.emits, rework.effects]).toEqual([[{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "test-writer" } }], []]);
  });
});
