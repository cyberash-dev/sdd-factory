import { withCostEntry } from "../../../bus/domain/run-state.js";
import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { integerField, optionalStringsField, stringField } from "../payload.js";
import { costEntryOf, laneEffect, taskOf, withTask, type RuleDeps } from "./support.js";

export function taskTestsWrittenRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.tests_written -> red check",
    eventType: "task.tests_written",
    acceptsTaskStatus: ["tests_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const attempt = integerField(event.payload, "attempt");
      const next = withTask(state, taskId, { ...task, lastEvent: event.type });
      return {
        state: { ...next, costLedger: withCostEntry(state.costLedger, costEntryOf(event.payload, "test-writer", taskId, deps.laneModel)) },
        emits: [],
        effects: [laneEffect(BUILD_EFFECT_KINDS.redCheck, { taskId, attempt, firewallViolations: optionalStringsField(event.payload, "firewallViolations") })],
      };
    },
  };
}
