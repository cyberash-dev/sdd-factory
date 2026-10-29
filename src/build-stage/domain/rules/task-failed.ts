import type { RUN_FAILED_REASONS } from "../../../bus/domain/catalogue.js";
import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { stringField } from "../payload.js";
import { foreman, laneEffect, taskOf, withTask } from "./support.js";

type RunFailedReason = (typeof RUN_FAILED_REASONS)[number];

/* bus:CTR-002 has no reason for a role that declared itself blocked; runtime_error is the closest value. */
export function runFailedReasonOf(taskReason: string): RunFailedReason {
  return taskReason === "cap_exhausted" || taskReason === "unparseable_handoff" ? taskReason : "runtime_error";
}

export function taskFailedRule(): TransitionRule {
  return {
    name: "task.failed -> run.failed",
    eventType: "task.failed",
    acceptsTaskStatus: ["ready", "tests_pending", "tests_red", "impl_pending", "verify_pending", "review_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const reason = stringField(event.payload, "reason");
      const detail = stringField(event.payload, "detail");
      return {
        state: withTask(state, taskId, { ...task, status: "failed", lastEvent: event.type }),
        emits: [foreman("run.failed", { stage: "build", reason: runFailedReasonOf(reason), detail: `${taskId}: ${reason}: ${detail}` })],
        effects: [laneEffect(BUILD_EFFECT_KINDS.terminateLanes, {})],
      };
    },
  };
}
