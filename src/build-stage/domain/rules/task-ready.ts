import type { TransitionRule } from "../../../bus/domain/transition.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { stringField, stringsField } from "../payload.js";
import { laneEffect, taskOf, withTask } from "./support.js";

export function taskReadyRule(): TransitionRule {
  return {
    name: "task.ready -> tests_pending",
    eventType: "task.ready",
    acceptsTaskStatus: ["ready"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const next = {
        ...task,
        status: "tests_pending" as const,
        attempts: { implementer: 0, testWriter: 1 },
        worktree: stringField(event.payload, "worktree"),
        baseSha: stringField(event.payload, "baseSha"),
        testsSha: null,
        implSha: null,
        covers: stringsField(event.payload, "covers"),
        writes: stringsField(event.payload, "writes"),
        lastEvent: event.type,
      };
      return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.testWriter, { taskId, attempt: 1, reworkFinding: null })] };
    },
  };
}
