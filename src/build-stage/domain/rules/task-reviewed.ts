import type { TaskState } from "../../../bus/domain/run-state.js";
import { withCostEntry } from "../../../bus/domain/run-state.js";
import type { PendingEvent, TransitionRule } from "../../../bus/domain/transition.js";
import type { RunState } from "../../../bus/domain/run-state.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { PayloadFieldError, stringField } from "../payload.js";
import { architectRework, costEntryOf, criticRework, foreman, hasCostFields, implementerRework, laneEffect, specIdsOf, taskOf, testWriterRework, withTask, type RuleDeps } from "./support.js";

interface Decision {
  readonly state: RunState;
  readonly task: TaskState;
  readonly taskId: string;
  readonly decision: string;
  readonly target: string;
  readonly reportPath: string;
  readonly specIds: readonly string[];
}

function malformedTarget(taskId: string): PendingEvent {
  return foreman("task.failed", { taskId, reason: "unparseable_handoff", detail: "reviewer: request_changes without target" });
}

function routeTarget(input: Decision, caps: RuleDeps["caps"], implementerReason: string, testWriterReason: string): PendingEvent {
  const { state, task, taskId, target, reportPath, specIds } = input;
  switch (target) {
    case "implementer":
      return implementerRework(task, taskId, caps, implementerReason, reportPath);
    case "test-writer":
      return testWriterRework(task, taskId, testWriterReason, reportPath);
    case "architect":
      return architectRework(state, taskId, caps, "design_repair", reportPath);
    case "contract":
      return criticRework(state, taskId, caps, specIds, reportPath);
    case "none":
      return malformedTarget(taskId);
    default:
      throw new PayloadFieldError(`task.reviewed.target: unexpected ${target}`);
  }
}

export function taskReviewedRule(deps: RuleDeps): TransitionRule {
  return {
    name: "task.reviewed -> integrate or rework",
    eventType: "task.reviewed",
    acceptsTaskStatus: ["review_pending"],
    apply({ state, event }) {
      const taskId = stringField(event.payload, "taskId");
      const task = taskOf(state, taskId);
      const ledger = hasCostFields(event.payload) ? withCostEntry(state.costLedger, costEntryOf(event.payload, "reviewer", taskId, null)) : state.costLedger;
      const stamped = { ...withTask(state, taskId, { ...task, lastEvent: event.type }), costLedger: ledger };
      const input: Decision = { state, task, taskId, decision: stringField(event.payload, "decision"), target: stringField(event.payload, "target"), reportPath: stringField(event.payload, "reportPath"), specIds: specIdsOf(event.payload) };
      const isArbitration = task.implSha === null;
      if (input.decision !== "request_changes") {
        if (isArbitration) {
          return { state: stamped, emits: [implementerRework(task, taskId, deps.caps, "claim_rejected", input.reportPath)], effects: [] };
        }
        return { state: stamped, emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.integrate, { taskId })] };
      }
      const emitted = isArbitration ? routeTarget(input, deps.caps, "claim_rejected", "test_contract_conflict") : routeTarget(input, deps.caps, "review_changes", "review_changes");
      return { state: stamped, emits: [emitted], effects: [] };
    },
  };
}
