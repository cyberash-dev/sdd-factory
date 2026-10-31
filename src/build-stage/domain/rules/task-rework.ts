import type { TransitionRule, TransitionResult } from "../../../bus/domain/transition.js";
import { simpleFixAttempts, withCriticAttempt, type RunState, type TaskState } from "../../../bus/domain/run-state.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { PayloadFieldError, stringField, stringOrNullField } from "../payload.js";
import { capExhausted, designReworkAttempt, findingTextOf, foreman, isTestWriterCapReached, laneEffect, specAssumeEffect, specIdsOf, tasksCovering, taskOf, withTask, type ReworkFinding, type RuleDeps } from "./support.js";

function implementerRestart(state: RunState, task: TaskState, taskId: string, reworkFinding: ReworkFinding, lastEvent: string): TransitionResult {
  const attempt = task.attempts.implementer + 1;
  const next = { ...task, status: "impl_pending" as const, implSha: null, attempts: { ...task.attempts, implementer: attempt }, lastEvent };
  return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.implementer, { taskId, attempt, reworkFinding })] };
}

function isDesignRestartReason(reason: string): boolean {
  return reason.startsWith("architect_repair") || reason === "planner_recut";
}

/* build-stage:BEH-008 arbitration routes a frozen test that contradicts the records to the test-writer with this reason. */
const ARBITRATION_REASON = "test_contract_conflict";

/* build-stage:DLT-016: an arbitration loss at the cap goes to the simple-fixer on the frozen tests; the fixer run is no test-writer attempt. */
function testWriterCapReached(state: RunState, task: TaskState, taskId: string, caps: RuleDeps["caps"], reworkFinding: ReworkFinding, lastEvent: string): TransitionResult {
  const hasFixerBudget = simpleFixAttempts(state, "test-writer", taskId) < caps.simpleFixes;
  if (reworkFinding.reason !== ARBITRATION_REASON || task.testsSha === null || !hasFixerBudget) {
    return { state: withTask(state, taskId, { ...task, lastEvent }), emits: [capExhausted(taskId, "test-writer")], effects: [] };
  }
  const next = { ...task, status: "tests_pending" as const, implementerAtRestart: task.attempts.implementer, testsSha: null, implSha: null, lastEvent };
  return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.arbitrationFix, { taskId, frozenTestsSha: task.testsSha, reworkFinding })] };
}

function laneRestart(state: RunState, task: TaskState, taskId: string, caps: RuleDeps["caps"], reworkFinding: ReworkFinding, lastEvent: string): TransitionResult {
  const isDesignRestart = isDesignRestartReason(reworkFinding.reason);
  if (!isDesignRestart && isTestWriterCapReached(task, caps)) {
    return testWriterCapReached(state, task, taskId, caps, reworkFinding, lastEvent);
  }
  const attempt = task.attempts.testWriter + 1;
  const designRestarts = isDesignRestart ? { designRestarts: (task.designRestarts ?? 0) + 1 } : {};
  /* build-stage:DLT-015: the state forgets testsSha here, so the effect carries the commit the worktree goes back to. */
  const frozenTests = isDesignRestart || task.testsSha === null ? {} : { frozenTestsSha: task.testsSha };
  const next = { ...task, ...designRestarts, status: "tests_pending" as const, attempts: { ...task.attempts, testWriter: attempt }, implementerAtRestart: task.attempts.implementer, testsSha: null, implSha: null, lastEvent };
  return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.restartLane, { taskId, attempt, reworkFinding, ...frozenTests })] };
}

/* The counter moves in the same transition as the effect: spec-stage reads it to enforce CST-005. */
function criticRoute(state: RunState, taskId: string, specIds: readonly string[], finding: string, findingPath: string | null): TransitionResult {
  const assumptionsByRecord = { ...state.assumptionsByRecord };
  for (const id of specIds) {
    assumptionsByRecord[id] = (assumptionsByRecord[id] ?? 0) + 1;
  }
  return { state: withTask({ ...state, assumptionsByRecord }, taskId, withCriticAttempt(taskOf(state, taskId))), emits: [], effects: [specAssumeEffect(taskId, specIds, finding, findingPath, tasksCovering(state, specIds))] };
}

export function taskReworkRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.rework -> re-run the target role",
    eventType: "task.rework",
    acceptsTaskStatus: ["tests_pending", "impl_pending", "verify_pending", "review_pending", "approved"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const target = stringField(event.payload, "target");
      const reason = stringField(event.payload, "reason");
      const findingPath = stringOrNullField(event.payload, "findingPath");
      const reworkFinding: ReworkFinding = { reason, findingPath };
      const stamped = withTask(state, taskId, { ...task, lastEvent: event.type });
      switch (target) {
        case "implementer":
          return implementerRestart(state, task, taskId, reworkFinding, event.type);
        case "test-writer":
          return laneRestart(state, task, taskId, deps.caps, reworkFinding, event.type);
        case "planner":
        case "architect":
          return { state: stamped, emits: [foreman("design.rework", { target, reason, attempt: designReworkAttempt(state), originTaskId: taskId, specIds: specIdsOf(event.payload), findingPath })], effects: [] };
        case "critic":
          return criticRoute(stamped, taskId, specIdsOf(event.payload), findingTextOf(event.payload, "finding", `${reason}; see ${findingPath ?? "the review report"}`), findingPath);
        default:
          throw new PayloadFieldError(`task.rework.target: unexpected ${target}`);
      }
    },
  };
}
