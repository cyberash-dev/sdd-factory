import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS, FOREIGN_EFFECT_KINDS } from "../../effect-kinds.js";
import { stringField } from "../payload.js";
import { allTasksApproved } from "../task-scheduling.js";
import { laneEffect, taskOf, withTask } from "./support.js";

export function taskApprovedRule(): TransitionRule {
  return {
    name: "task.approved -> approved, schedule dependents",
    eventType: "task.approved",
    acceptsTaskStatus: ["review_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const next = withTask(state, taskId, { ...task, status: "approved", implSha: stringField(event.payload, "implSha"), lastEvent: event.type });
      const effects = [laneEffect(BUILD_EFFECT_KINDS.schedule, {})];
      if (allTasksApproved(next)) {
        effects.push({ kind: FOREIGN_EFFECT_KINDS.assemblyStart });
      }
      return { state: next, emits: [], effects };
    },
  };
}
