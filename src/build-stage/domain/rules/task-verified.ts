import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { PayloadFieldError, stringField } from "../payload.js";
import { implementerRework, laneEffect, taskOf, withTask, type RuleDeps } from "./support.js";

export function taskVerifiedRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.verified -> review or implementer rework",
    eventType: "task.verified",
    acceptsTaskStatus: ["verify_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      if (stringField(event.payload, "result") === "red") {
        const stamped = withTask(state, taskId, { ...task, lastEvent: event.type });
        return { state: stamped, emits: [implementerRework(task, taskId, deps.caps, "verification_red", stringField(event.payload, "evidencePath"))], effects: [] };
      }
      const implSha = event.payload["implSha"];
      if (typeof implSha !== "string") {
        throw new PayloadFieldError("task.verified{green} must carry implSha of the verified commit");
      }
      const next = withTask(state, taskId, { ...task, status: "review_pending", implSha, lastEvent: event.type });
      return { state: next, emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.reviewer, { taskId, mode: "review", attempt: task.attempts.implementer })] };
    },
  };
}
