import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { stringField } from "../payload.js";
import { laneEffect, taskOf, withTask } from "./support.js";

export function taskTestsRedRule(): TransitionRule {
  return {
    name: "task.tests_red -> impl_pending",
    eventType: "task.tests_red",
    acceptsTaskStatus: ["tests_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const attempt = task.attempts.implementer + 1;
      const next = { ...task, status: "impl_pending" as const, testsSha: stringField(event.payload, "testsSha"), implSha: null, attempts: { ...task.attempts, implementer: attempt }, lastEvent: event.type };
      return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.implementer, { taskId, attempt, reworkFinding: null })] };
    },
  };
}
