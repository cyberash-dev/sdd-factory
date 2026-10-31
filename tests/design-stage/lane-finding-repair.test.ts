import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../src/bus/domain/envelope.js";
import { createTaskState, type RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type Effect, type TransitionResult, type TransitionRule } from "../../src/bus/domain/transition.js";
import { runArchitectEffect } from "../../src/design-stage/application/architect-effect.js";
import { runPlanEffect } from "../../src/design-stage/application/plan-effect.js";
import { createDesignRules } from "../../src/design-stage/domain/rules.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { ARCHITECT_HANDOFF_LINES, handoffPathIn, handoffText, PLANNER_HANDOFF_LINES, stateIn, tasksJsonText, techMdText, VALID_TASKS, verificationMdText, writeVia, harness, type RoleScript } from "./harness.js";

const buildRules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });
const designRules = createDesignRules({ caps: DEFAULT_CONFIG.caps, worktreesDir: "/run/worktrees" });

const architectRepairing: RoleScript = async (request) => {
  await writeVia(request, "design/tech.md", techMdText());
  await writeVia(request, handoffPathIn(request), handoffText("architect", 2, ARCHITECT_HANDOFF_LINES));
};

const plannerKeepingTasks: RoleScript = async (request) => {
  await writeVia(request, "design/tasks.json", tasksJsonText(VALID_TASKS));
  await writeVia(request, "design/plan.md", "# Plan: todo-cli\n");
  await writeVia(request, handoffPathIn(request), handoffText("planner", 2, PLANNER_HANDOFF_LINES));
};

function buildingWithT003(): RunState {
  const task = { ...createTaskState({ worktree: "/run/worktrees/T-003", covers: ["todo-cli:INV-004", "todo-cli:CON-006"], writes: ["src/index.ts"], dependsOn: ["T-002"] }), status: "impl_pending" as const };
  return stateIn("building", { tasks: { "T-003": task } });
}

function implementerHandoffWithFinding(type: string, specIds: readonly string[], detail: string): string {
  const quotedIds = specIds.map((id) => `"${id}"`).join(", ");
  return ["---", "role: implementer", "attempt: 2", "status: finding", 'changed_files: ["src/index.ts"]', "finding:", `  type: ${type}`, `  spec_ids: [${quotedIds}]`, `  detail: "${detail}"`, "---", "", "decisions:", "- run delegates argv parsing to parseArgs."].join("\n");
}

async function laneHandoffAt(handoffsDir: string, text: string): Promise<string> {
  const path = join(handoffsDir, "tasks", "T-003", "implementer-2", "handoff.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
  return path;
}

async function seedDesign(productDir: string): Promise<void> {
  await mkdir(join(productDir, "design"), { recursive: true });
  await writeFile(join(productDir, "design", "tech.md"), techMdText(), "utf8");
  await writeFile(join(productDir, "design", "verification.md"), verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]), "utf8");
  await writeFile(join(productDir, "design", "tasks.json"), tasksJsonText(VALID_TASKS), "utf8");
}

function appliedTo(rules: readonly TransitionRule[], state: RunState, type: EventType, payload: EventPayload): TransitionResult {
  const event: DeliveredEvent<EventType> = { type, runId: state.runId, occurredAt: "2026-10-31T01:29:14.782Z", producer: "foreman", payload, seq: 22 };
  const outcome = reduce(rules, state, event, new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected ${type} to apply, got ${outcome.kind}`);
  }
  return outcome.result;
}

/* Routes task.rework through the build-stage rule and the design.rework it emits through the design rules. */
function designEffectFor(state: RunState, taskRework: EventPayload): Effect {
  const routed = appliedTo(buildRules, state, "task.rework", taskRework);
  const designRework = routed.emits[0];
  if (designRework === undefined) {
    throw new Error("task.rework emitted no design.rework");
  }
  const effect = appliedTo(designRules, routed.state, designRework.type, designRework.payload).effects[0];
  if (effect === undefined) {
    throw new Error("design.rework scheduled no effect");
  }
  return effect;
}

function reworkFindingIn(message: string): string {
  const match = /^- rework_finding: ([\s\S]*?)\n(?:- graph_depth: |\nRelative paths)/m.exec(message);
  if (match === null || match[1] === undefined) {
    throw new Error("message carries no rework_finding");
  }
  return match[1];
}

describe("design repair routed from a lane finding", () => {
  // @covers design-stage:DLT-010
  // @covers design-stage:BEH-004
  it("hands the repairing architect the implementer's finding detail and the finding's spec ids", async () => {
    const h = await harness({ scripts: { architect: [architectRepairing] } });
    const findingPath = await laneHandoffAt(h.slice.paths.handoffsDir, implementerHandoffWithFinding("VD-INFEASIBLE", ["todo-cli:INV-004", "todo-cli:CON-006"], "src/cli/index.ts emits usage: todo [arguments]"));
    const state = buildingWithT003();
    const effect = designEffectFor(state, { taskId: "T-003", target: "architect", attempt: 1, reason: "design_repair", findingPath, specIds: ["todo-cli:INV-004", "todo-cli:CON-006"] });

    await runArchitectEffect(effect, h.context(state), h.slice);

    const finding = reworkFindingIn(h.roleCalls[0]?.message ?? "");
    expect([finding.includes("src/cli/index.ts emits usage: todo [arguments]"), finding.includes("todo-cli:INV-004, todo-cli:CON-006")]).toEqual([true, true]);
  });

  // @covers design-stage:DLT-010
  // @covers design-stage:BEH-004
  it("hands the re-cutting planner the implementer's TASK-OVERFLOW detail", async () => {
    const h = await harness({ scripts: { planner: [plannerKeepingTasks] } });
    await seedDesign(h.productDir);
    const findingPath = await laneHandoffAt(h.slice.paths.handoffsDir, implementerHandoffWithFinding("TASK-OVERFLOW", [], "T-003 needs src/cli/index.ts, which T-001 owns"));
    const state = buildingWithT003();
    const effect = designEffectFor(state, { taskId: "T-003", target: "planner", attempt: 1, reason: "task_overflow", findingPath });

    await runPlanEffect(effect, h.context(state), h.slice, h.commandRunner);

    expect(reworkFindingIn(h.roleCalls[0]?.message ?? "").includes("T-003 needs src/cli/index.ts, which T-001 owns")).toBe(true);
  });

  // @covers design-stage:DLT-010
  it("hands the repairing architect the reason alone when the finding has no file", async () => {
    const h = await harness({ scripts: { architect: [architectRepairing] } });
    const state = buildingWithT003();
    const effect = designEffectFor(state, { taskId: "T-003", target: "architect", attempt: 1, reason: "design_repair", findingPath: null, specIds: ["todo-cli:INV-004"] });

    await runArchitectEffect(effect, h.context(state), h.slice);

    expect(reworkFindingIn(h.roleCalls[0]?.message ?? "")).toBe("design_repair");
  });

  // @covers design-stage:DLT-010
  it("hands the repairing architect the reason alone when the finding file is gone", async () => {
    const h = await harness({ scripts: { architect: [architectRepairing] } });
    const state = buildingWithT003();
    const effect = designEffectFor(state, { taskId: "T-003", target: "architect", attempt: 1, reason: "design_repair", findingPath: join(h.slice.paths.handoffsDir, "tasks", "T-003", "implementer-3", "handoff.md"), specIds: ["todo-cli:INV-004"] });

    await runArchitectEffect(effect, h.context(state), h.slice);

    expect(reworkFindingIn(h.roleCalls[0]?.message ?? "")).toBe("design_repair");
  });
});
