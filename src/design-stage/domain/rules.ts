import { join } from "node:path";
import type { EventPayload } from "../../bus/domain/envelope.js";
import type { RunState, TaskState } from "../../bus/domain/run-state.js";
import { createTaskState } from "../../bus/domain/run-state.js";
import type { Effect, PendingEvent, TransitionResult, TransitionRule } from "../../bus/domain/transition.js";
import type { Caps } from "../../shared/config.js";
import { integerOf, ledgerWithUsage, stringListOf, stringOf, taskSummariesOf, withStageReruns, type TaskSummary } from "./payloads.js";

export interface DesignRuleDeps {
  readonly caps: Caps;
  readonly worktreesDir: string;
}

export const DESIGN_STATUSES = ["designing", "planning", "building"] as const;

function designBlocked(reason: string): PendingEvent {
  return { type: "design.blocked", producer: "foreman", payload: { reason } };
}

function runFailed(reason: "design_blocked" | "cap_exhausted", detail: string): PendingEvent {
  return { type: "run.failed", producer: "foreman", payload: { stage: "design", reason, detail } };
}

function testWriterRework(taskId: string, task: TaskState, reason: string): PendingEvent {
  return { type: "task.rework", producer: "foreman", payload: { taskId, target: "test-writer", attempt: task.attempts.testWriter + 1, reason, findingPath: null } };
}

function unchanged(state: RunState): TransitionResult {
  return { state, emits: [], effects: [] };
}

function withRoleAccounting(state: RunState, event: { readonly payload: EventPayload }, role: "architect" | "verification-designer" | "planner"): RunState {
  const reruns = integerOf(event.payload, "handoffReruns");
  return { ...state, costLedger: ledgerWithUsage(state.costLedger, event.payload, role), stageHandoffReruns: withStageReruns(state, role, reruns) };
}

function planEffect(attempt: number, reworkFinding: string): Effect {
  return { kind: "design.plan", attempt, reworkFinding };
}

function readyRule(eventType: "design.tech.ready" | "design.verification.ready"): TransitionRule {
  const role = eventType === "design.tech.ready" ? "architect" : "verification-designer";
  const flag = eventType === "design.tech.ready" ? "techReady" : "verificationReady";
  return {
    name: `${eventType} -> barrier`,
    eventType,
    acceptsRunStatus: role === "architect" ? ["designing", "building"] : ["designing"],
    apply({ state, event }) {
      const base = withRoleAccounting(state, event, role);
      if (state.status === "building") {
        const specIds = stringListOf(event.payload, "specIds");
        const emits = Object.entries(state.tasks)
          .filter(([, task]) => task.covers.some((id) => specIds.includes(id)))
          .map(([taskId, task]) => testWriterRework(taskId, task, `architect_repair: ${specIds.join(", ")}`));
        return { state: base, emits, effects: [] };
      }
      const design = { ...state.design, [flag]: true };
      if (!(design.techReady && design.verificationReady)) {
        return unchanged({ ...base, design });
      }
      return { state: { ...base, design, status: "planning" }, emits: [], effects: [planEffect(1, "")] };
    },
  };
}

function taskStateFrom(summary: TaskSummary, worktreesDir: string): TaskState {
  return createTaskState({ worktree: join(worktreesDir, summary.id), covers: summary.covers, writes: summary.writes, dependsOn: summary.dependsOn });
}

function mergeTasks(state: RunState, summaries: readonly TaskSummary[], changedIds: readonly string[], worktreesDir: string): { readonly tasks: Record<string, TaskState>; readonly emits: PendingEvent[] } {
  const tasks: Record<string, TaskState> = {};
  const emits: PendingEvent[] = [];
  for (const summary of summaries) {
    const existing = state.tasks[summary.id];
    if (existing === undefined) {
      tasks[summary.id] = taskStateFrom(summary, worktreesDir);
      continue;
    }
    if (!changedIds.includes(summary.id)) {
      tasks[summary.id] = existing;
      continue;
    }
    tasks[summary.id] = { ...existing, covers: summary.covers, writes: summary.writes, dependsOn: summary.dependsOn, lastEvent: "design.tasks.ready" };
    emits.push(testWriterRework(summary.id, existing, "planner_recut"));
  }
  return { tasks, emits };
}

function tasksReadyRule(deps: DesignRuleDeps): TransitionRule {
  return {
    name: "design.tasks.ready -> building",
    eventType: "design.tasks.ready",
    acceptsRunStatus: ["planning", "building"],
    apply({ state, event }) {
      const summaries = taskSummariesOf(event.payload);
      const path = stringOf(event.payload, "path");
      const base = withRoleAccounting(state, event, "planner");
      const effects: Effect[] = [{ kind: "build.schedule", tasksPath: path }];
      if (state.status === "building") {
        const merged = mergeTasks(state, summaries, stringListOf(event.payload, "changedTaskIds"), deps.worktreesDir);
        return { state: { ...base, design: { ...state.design, tasksPath: path }, tasks: merged.tasks }, emits: merged.emits, effects };
      }
      const tasks = Object.fromEntries(summaries.map((summary) => [summary.id, taskStateFrom(summary, deps.worktreesDir)]));
      return { state: { ...base, status: "building", design: { ...state.design, tasksPath: path }, tasks }, emits: [], effects };
    },
  };
}

function plannerRework(deps: DesignRuleDeps, state: RunState, reason: string): TransitionResult {
  const recuts = state.stageAttempts.plannerRecuts + 1;
  if (recuts > deps.caps.plannerRecuts) {
    return { state, emits: [designBlocked("planner_cap")], effects: [] };
  }
  const next: RunState = { ...state, status: state.status === "building" ? "building" : "planning", stageAttempts: { ...state.stageAttempts, plannerRecuts: recuts } };
  return { state: next, emits: [], effects: [planEffect(recuts + 1, reason)] };
}

function architectRework(deps: DesignRuleDeps, state: RunState, reason: string, specIds: readonly string[]): TransitionResult {
  const repairs = state.stageAttempts.architectRepairs + 1;
  if (repairs > deps.caps.architectRepairs) {
    const detail = `architect repairs cap ${deps.caps.architectRepairs} exceeded: ${reason}`;
    return { state, emits: [runFailed("cap_exhausted", detail)], effects: [] };
  }
  const design = state.status === "designing" ? { ...state.design, techReady: false } : state.design;
  const next: RunState = { ...state, design, stageAttempts: { ...state.stageAttempts, architectRepairs: repairs } };
  return { state: next, emits: [], effects: [{ kind: "design.architect", attempt: repairs + 1, reworkFinding: reason, specIds }] };
}

function reworkRule(deps: DesignRuleDeps): TransitionRule {
  return {
    name: "design.rework -> re-run target",
    eventType: "design.rework",
    acceptsRunStatus: DESIGN_STATUSES,
    apply({ state, event }) {
      const target = stringOf(event.payload, "target");
      const reason = stringOf(event.payload, "reason");
      const role = target === "architect" ? "architect" : "planner";
      const base = withRoleAccounting(state, event, role);
      return target === "architect" ? architectRework(deps, base, reason, stringListOf(event.payload, "specIds")) : plannerRework(deps, base, reason);
    },
  };
}

/* Only the factory's run.failed rule moves the run into a terminal status; this rule announces the failure. */
const blockedRule: TransitionRule = {
  name: "design.blocked -> run.failed",
  eventType: "design.blocked",
  acceptsRunStatus: DESIGN_STATUSES,
  apply({ state, event }) {
    const reason = stringOf(event.payload, "reason");
    const detail = stringOf(event.payload, "detail") || reason;
    return { state, emits: [runFailed("design_blocked", detail)], effects: [] };
  },
};

export function createDesignRules(deps: DesignRuleDeps): readonly TransitionRule[] {
  return [readyRule("design.tech.ready"), readyRule("design.verification.ready"), tasksReadyRule(deps), reworkRule(deps), blockedRule];
}
