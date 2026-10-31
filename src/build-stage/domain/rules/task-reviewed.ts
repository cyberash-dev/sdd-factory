import { isAbsolute, join } from "node:path";
import type { TaskState } from "../../../bus/domain/run-state.js";
import { withCostEntry } from "../../../bus/domain/run-state.js";
import type { PendingEvent, TransitionRule } from "../../../bus/domain/transition.js";
import type { RunState } from "../../../bus/domain/run-state.js";
import { BUILD_EFFECT_KINDS } from "../../effect-kinds.js";
import { PayloadFieldError, stringField } from "../payload.js";
import { architectRework, costEntryOf, criticRework, findingTextOf, foreman, hasCostFields, implementerRework, isArchitectCapReached, isCriticCapReached, isImplementerCapReached, isTestWriterCapReached, laneEffect, specIdsOf, taskOf, testWriterRework, withTask, type RuleDeps } from "./support.js";

interface Decision {
  readonly state: RunState;
  readonly task: TaskState;
  readonly taskId: string;
  readonly decision: string;
  readonly target: string;
  readonly reportPath: string;
  readonly specIds: readonly string[];
  readonly findingText: string;
}

function malformedTarget(taskId: string): PendingEvent {
  return foreman("task.failed", { taskId, reason: "unparseable_handoff", detail: "reviewer: request_changes without target" });
}

/* design-stage:DLT-010: the design stage reads the finding outside the worktree, so the review report path must be absolute. */
function worktreeAnchored(task: TaskState, reportPath: string): string {
  return isAbsolute(reportPath) ? reportPath : join(task.worktree, reportPath);
}

function routeTarget(input: Decision, caps: RuleDeps["caps"], implementerReason: string, testWriterReason: string): PendingEvent {
  const { state, task, taskId, target, reportPath, specIds, findingText } = input;
  switch (target) {
    case "implementer":
      return implementerRework(task, taskId, caps, implementerReason, reportPath);
    case "test-writer":
      return testWriterRework(task, taskId, testWriterReason, reportPath);
    case "architect":
      return architectRework(state, taskId, caps, "design_repair", worktreeAnchored(task, reportPath), specIds);
    case "contract":
      return criticRework(state, taskId, caps, specIds, reportPath, findingText);
    case "none":
      return malformedTarget(taskId);
    default:
      throw new PayloadFieldError(`task.reviewed.target: unexpected ${target}`);
  }
}

/* build-stage:DLT-013: the role names match the cap_exhausted detail the guard of the same route emits. */
function capReachedRoleOf(input: Decision, caps: RuleDeps["caps"]): string | null {
  const { state, task, target, specIds } = input;
  switch (target) {
    case "implementer":
      return isImplementerCapReached(task, caps) ? "implementer" : null;
    case "test-writer":
      return isTestWriterCapReached(task, caps) ? "test-writer" : null;
    case "architect":
      return isArchitectCapReached(state, caps) ? "architect" : null;
    case "contract":
      return isCriticCapReached(state, caps, specIds) ? "critic" : null;
    default:
      return null;
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
      const input: Decision = { state, task, taskId, decision: stringField(event.payload, "decision"), target: stringField(event.payload, "target"), reportPath: stringField(event.payload, "reportPath"), specIds: specIdsOf(event.payload), findingText: findingTextOf(event.payload, "findingText", `spec contradiction reported in ${stringField(event.payload, "reportPath")}`) };
      const isArbitration = task.implSha === null;
      if (input.decision !== "request_changes") {
        if (isArbitration) {
          return { state: stamped, emits: [implementerRework(task, taskId, deps.caps, "claim_rejected", input.reportPath)], effects: [] };
        }
        return { state: stamped, emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.integrate, { taskId })] };
      }
      if (isArbitration) {
        return { state: stamped, emits: [routeTarget(input, deps.caps, "claim_rejected", "test_contract_conflict")], effects: [] };
      }
      /* build-stage:DLT-013: a review runs only after task.verified{green}, so a route beyond its cap approves on that evidence. */
      const capReachedRole = capReachedRoleOf(input, deps.caps);
      if (capReachedRole !== null) {
        return { state: stamped, emits: [], effects: [laneEffect(BUILD_EFFECT_KINDS.integrate, { taskId, capReachedRole })] };
      }
      return { state: stamped, emits: [routeTarget(input, deps.caps, "review_changes", "review_changes")], effects: [] };
    },
  };
}
