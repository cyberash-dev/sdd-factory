import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type PendingEvent, type TransitionResult, type TransitionRule } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { runPlanEffect } from "../../src/design-stage/application/plan-effect.js";
import { createDesignRules } from "../../src/design-stage/domain/rules.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { handoffPathIn, handoffText, harness, PLANNER_HANDOFF_LINES, tasksJsonText, techMdText, VALID_TASKS, verificationMdText, writeVia, type RoleScript } from "../design-stage/harness.js";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { handoffPathFromWorktree, laneState, provisionLane, runLaneEffect } from "./support/lanes.js";
import { aProductRepo } from "./support/product.js";
import { scriptedCliRoles, writeHandoff } from "./support/runners.js";
import { delivered } from "./support/state.js";

const buildRules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });
const designRules = createDesignRules({ caps: DEFAULT_CONFIG.caps, worktreesDir: "/run/worktrees" });

const plannerKeepingTasks: RoleScript = async (request) => {
  await writeVia(request, "design/tasks.json", tasksJsonText(VALID_TASKS));
  await writeVia(request, "design/plan.md", "# Plan: todo-cli\n");
  await writeVia(request, handoffPathIn(request), handoffText("planner", 2, PLANNER_HANDOFF_LINES));
};

async function seedDesign(productDir: string): Promise<void> {
  await mkdir(join(productDir, "design"), { recursive: true });
  await writeFile(join(productDir, "design", "tech.md"), techMdText(), "utf8");
  await writeFile(join(productDir, "design", "verification.md"), verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]), "utf8");
  await writeFile(join(productDir, "design", "tasks.json"), tasksJsonText(VALID_TASKS), "utf8");
}

function appliedTo(rules: readonly TransitionRule[], state: RunState, event: PendingEvent | undefined): TransitionResult {
  if (event === undefined) {
    throw new Error("expected an event to route");
  }
  const outcome = reduce(rules, state, delivered(event.type, event.payload), new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected ${event.type} to apply, got ${outcome.kind}`);
  }
  return outcome.result;
}

/* Routes the test-writer's task.rework through the build-stage rule and the design.rework it emits through the design rules. */
function planEffectFor(state: RunState, rework: PendingEvent | undefined): { readonly state: RunState; readonly effect: Effect } {
  const routed = appliedTo(buildRules, state, rework);
  const planned = appliedTo(designRules, routed.state, routed.emits[0]);
  const effect = planned.effects[0];
  if (effect === undefined) {
    throw new Error("design.rework scheduled no effect");
  }
  return { state: planned.state, effect };
}

async function aBlockedTestWriterRework(blockedReason: string): Promise<{ readonly state: RunState; readonly published: readonly PendingEvent[] }> {
  const cliRoles = scriptedCliRoles(async (request) => {
    await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), { role: "test-writer", attempt: 1, status: "blocked", test_files: [], covers: [], blocked_reason: blockedReason });
  });
  const lane = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
  const state = laneState(await provisionLane(lane));
  return { state, published: await runLaneEffect(lane, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, state) };
}

describe("blocked test-writer re-cut", () => {
  // @covers build-stage:DLT-017
  it("hands the re-cutting planner the test-writer's blocked reason", async () => {
    const blocked = await aBlockedTestWriterRework("the HTTP boundary of greeter:BEH-001 belongs to T-002");
    const design = await harness({ scripts: { planner: [plannerKeepingTasks] } });
    await seedDesign(design.productDir);
    const recut = planEffectFor(blocked.state, blocked.published[0]);

    await runPlanEffect(recut.effect, design.context(recut.state), design.slice, design.commandRunner);

    const plannerMessage = design.roleCalls[0]?.message ?? "";
    expect([plannerMessage.includes("- rework_finding: test_writer_blocked"), plannerMessage.includes("the HTTP boundary of greeter:BEH-001 belongs to T-002")]).toEqual([true, true]);
  });
});
