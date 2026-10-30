import type { TransitionRule, TransitionResult } from "../../../bus/domain/transition.js";
import type { RunState } from "../../../bus/domain/run-state.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { laneHandoffPath } from "../handoff-paths.js";
import { PayloadFieldError, stringField, stringsField } from "../payload.js";
import { architectRework, foreman, laneEffect, plannerRework, taskOf, withTask, type RuleDeps } from "./support.js";

export const TOOLING_RERUN_KEY = "tooling";

function toolingRoute(state: RunState, taskId: string, attempt: number, origin: string, detail: string): TransitionResult {
  const reruns = state.stageHandoffReruns[TOOLING_RERUN_KEY] ?? 0;
  if (reruns > 0) {
    return { state, emits: [foreman("run.failed", { stage: "build", reason: "tooling_broken", detail: `${taskId}: ${detail}` })], effects: [] };
  }
  const next = { ...state, stageHandoffReruns: { ...state.stageHandoffReruns, [TOOLING_RERUN_KEY]: 1 } };
  return { state: next, emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.reprovision, { taskId, origin, attempt })] };
}

export function taskFindingRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.finding -> arbitration, planner, architect or re-provision",
    eventType: "task.finding",
    acceptsTaskStatus: ["tests_pending", "impl_pending", "verify_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const type = stringField(event.payload, "type");
      const detail = stringField(event.payload, "detail");
      const attempt = task.attempts.implementer;
      const findingPath = laneHandoffPath(deps.handoffsDir, taskId, "implementer", attempt);
      const stamped = withTask(state, taskId, { ...task, lastEvent: event.type });
      switch (type) {
        case "TEST-CONTRACT-CONFLICT":
          return {
            state: withTask(state, taskId, { ...task, status: "review_pending", lastEvent: event.type }),
            emits: [],
            effects: [laneEffect(BUILD_EFFECT_KINDS.reviewer, { taskId, mode: "arbitration", attempt, finding: { type, specIds: stringsField(event.payload, "specIds"), detail } })],
          };
        case "TASK-OVERFLOW":
          return { state: stamped, emits: [plannerRework(state, taskId, deps.caps, "task_overflow", findingPath)], effects: [] };
        case "VD-INFEASIBLE":
          return { state: stamped, emits: [architectRework(state, taskId, deps.caps, "design_repair", findingPath, stringsField(event.payload, "specIds"))], effects: [] };
        case "TOOLING-BROKEN": {
          const origin = typeof event.payload["origin"] === "string" ? event.payload["origin"] : "implementer";
          return toolingRoute(stamped, taskId, origin === "red-check" ? task.attempts.testWriter : attempt, origin, detail);
        }
        default:
          throw new PayloadFieldError(`task.finding.type: unexpected ${type}`);
      }
    },
  };
}
