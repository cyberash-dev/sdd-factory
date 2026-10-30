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
      /* bus:INV-002: a task that returns to ready after a re-cut keeps its counters; the next attempt follows them. */
      const testWriter = task.attempts.testWriter + 1;
      const next = {
        ...task,
        status: "tests_pending" as const,
        attempts: { ...task.attempts, testWriter },
        worktree: stringField(event.payload, "worktree"),
        baseSha: stringField(event.payload, "baseSha"),
        testsSha: null,
        implSha: null,
        covers: stringsField(event.payload, "covers"),
        writes: stringsField(event.payload, "writes"),
        lastEvent: event.type,
      };
      return { state: withTask(state, taskId, next), emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.testWriter, { taskId, attempt: testWriter, reworkFinding: null })] };
    },
  };
}
