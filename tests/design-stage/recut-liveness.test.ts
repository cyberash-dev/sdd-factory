import { describe, expect, it } from "vitest";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../src/bus/domain/envelope.js";
import { createTaskState, type RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type TransitionResult } from "../../src/bus/domain/transition.js";
import { createDesignRules } from "../../src/design-stage/domain/rules.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { stateIn } from "./harness.js";

const rules = createDesignRules({ caps: DEFAULT_CONFIG.caps, worktreesDir: "/run/worktrees" });

function applied(state: RunState, type: EventType, payload: EventPayload): TransitionResult {
  const event: DeliveredEvent<EventType> = { type, runId: state.runId, occurredAt: "2026-10-30T12:00:01.000Z", producer: "foreman", payload, seq: 9 };
  const outcome = reduce(rules, state, event, new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

describe("planner re-cut during build", () => {
  // @covers build-stage:DLT-008
  // @covers build-stage:BEH-009
  it("hands the task whose finding caused the re-cut to the planner effect", () => {
    const result = applied(stateIn("building"), "design.rework", { target: "planner", reason: "task_overflow", attempt: 1, originTaskId: "T-001" });

    expect(result.effects).toEqual([{ kind: "design.plan", attempt: 2, reworkFinding: "task_overflow", originTaskId: "T-001" }]);
  });

  // @covers build-stage:DLT-008
  // @covers build-stage:BEH-009
  it("names the tasks the re-cut removed in the build schedule so their lanes are cancelled", () => {
    const kept = createTaskState({ worktree: "/run/worktrees/T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**"], dependsOn: [] });
    const removed = { ...createTaskState({ worktree: "/run/worktrees/T-002", covers: ["todo-cli:CTR-002"], writes: ["src/store/**"], dependsOn: [] }), status: "impl_pending" as const };
    const state = stateIn("building", { tasks: { "T-001": kept, "T-002": removed } });

    const result = applied(state, "design.tasks.ready", { path: "design/tasks.json", taskCount: 1, tasks: [{ id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:CTR-002"], writes: ["src/cli/**", "src/store/**"], dependsOn: [] }], changedTaskIds: ["T-001", "T-002"] });

    expect(result.effects).toEqual([{ kind: "build.schedule", tasksPath: "design/tasks.json", removedTaskIds: ["T-002"] }]);
  });
});
