import type { TransitionRule, TransitionResult } from "../../../bus/domain/transition.js";
import type { RunState, TaskState } from "../../../bus/domain/run-state.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { PayloadFieldError, stringField, stringOrNullField } from "../payload.js";
import { capExhausted, foreman, laneEffect, specAssumeEffect, specIdsOf, tasksCovering, taskOf, withTask, type ReworkFinding, type RuleDeps } from "./support.js";

function implementerRestart(state: RunState, task: TaskState, taskId: string, reworkFinding: ReworkFinding, lastEvent: string): TransitionResult {
  const attempt = task.attempts.implementer + 1;
  const next = { ...task, status: "impl_pending" as const, implSha: null, attempts: { ...task.attempts, implementer: attempt }, lastEvent };
  return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.implementer, { taskId, attempt, reworkFinding })] };
}

function laneRestart(state: RunState, task: TaskState, taskId: string, caps: RuleDeps["caps"], reworkFinding: ReworkFinding, lastEvent: string): TransitionResult {
  if (task.attempts.testWriter > caps.testWriterRework) {
    return { state: withTask(state, taskId, { ...task, lastEvent }), emits: [capExhausted(taskId, "test-writer")], effects: [] };
  }
  const attempt = task.attempts.testWriter + 1;
  const next = { ...task, status: "tests_pending" as const, attempts: { implementer: 0, testWriter: attempt }, testsSha: null, implSha: null, lastEvent };
  return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.restartLane, { taskId, attempt, reworkFinding })] };
}

function criticRoute(state: RunState, taskId: string, specIds: readonly string[], findingPath: string | null): TransitionResult {
  const assumptionsByRecord = { ...state.assumptionsByRecord };
  for (const id of specIds) {
    assumptionsByRecord[id] = (assumptionsByRecord[id] ?? 0) + 1;
  }
  return { state: { ...state, assumptionsByRecord }, emits: [], effects: [specAssumeEffect(taskId, specIds, findingPath, tasksCovering(state, specIds))] };
}

export function taskReworkRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.rework -> re-run the target role",
    eventType: "task.rework",
    acceptsTaskStatus: ["tests_pending", "impl_pending", "verify_pending", "review_pending"],
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
        case "planner": {
          const attempt = state.stageAttempts.plannerRecuts + 1;
          return { state: { ...stamped, stageAttempts: { ...state.stageAttempts, plannerRecuts: attempt } }, emits: [foreman("design.rework", { target: "planner", reason, attempt })], effects: [] };
        }
        case "architect": {
          const attempt = state.stageAttempts.architectRepairs + 1;
          return { state: { ...stamped, stageAttempts: { ...state.stageAttempts, architectRepairs: attempt } }, emits: [foreman("design.rework", { target: "architect", reason, attempt })], effects: [] };
        }
        case "critic":
          return criticRoute(stamped, taskId, specIdsOf(event.payload), findingPath);
        default:
          throw new PayloadFieldError(`task.rework.target: unexpected ${target}`);
      }
    },
  };
}
