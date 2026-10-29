import type { TransitionRule } from "../../../bus/domain/transition.js";
import { stringField } from "../payload.js";
import { unchanged } from "./emit.js";

export function assemblyReworkRule(): TransitionRule {
  return {
    name: "assembly.rework -> bookkeeping",
    eventType: "assembly.rework",
    acceptsRunStatus: ["building"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = state.tasks[taskId];
      if (task === undefined) {
        return unchanged(state);
      }
      return unchanged({ ...state, tasks: { ...state.tasks, [taskId]: { ...task, lastEvent: event.type } } });
    },
  };
}
