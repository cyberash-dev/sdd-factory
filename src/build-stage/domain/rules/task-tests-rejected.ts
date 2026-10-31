import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { stringField } from "../payload.js";
import { capExhausted, countedTestWriterAttempts, laneEffect, taskOf, withTask, type ReworkFinding, type RuleDeps } from "./support.js";

export function taskTestsRejectedRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.tests_rejected -> lane restart or cap",
    eventType: "task.tests_rejected",
    acceptsTaskStatus: ["tests_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const stamped = withTask(state, taskId, { ...task, lastEvent: event.type });
      if (countedTestWriterAttempts(task) > deps.caps.testWriterRework) {
        return { state: stamped, emits: [capExhausted(taskId, "test-writer")], effects: [] };
      }
      const attempt = task.attempts.testWriter + 1;
      const reworkFinding: ReworkFinding = { reason: `${stringField(event.payload, "reason")}: ${stringField(event.payload, "detail")}`, findingPath: null };
      const next = { ...task, attempts: { ...task.attempts, testWriter: attempt }, implementerAtRestart: task.attempts.implementer, testsSha: null, implSha: null, lastEvent: event.type };
      return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.restartLane, { taskId, attempt, reworkFinding })] };
    },
  };
}
