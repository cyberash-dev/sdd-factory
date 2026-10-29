import { withCostEntry } from "../../../bus/domain/run-state.js";
import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { integerField, stringField } from "../payload.js";
import { costEntryOf, laneEffect, taskOf, withTask, type RuleDeps } from "./support.js";

export function taskImplDoneRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.impl_done -> verify_pending",
    eventType: "task.impl_done",
    acceptsTaskStatus: ["impl_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const next = withTask(state, taskId, { ...task, status: "verify_pending", lastEvent: event.type });
      return {
        state: { ...next, costLedger: withCostEntry(state.costLedger, costEntryOf(event.payload, "implementer", taskId, deps.laneModel)) },
        emits: [],
        effects: [laneEffect(BUILD_EFFECT_KINDS.greenCheck, { taskId, attempt: integerField(event.payload, "attempt") })],
      };
    },
  };
}
