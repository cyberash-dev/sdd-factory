import type { EventPayload, Producer } from "../../../bus/domain/envelope.js";
import type { CostEntry, RunState, TaskState } from "../../../bus/domain/run-state.js";
import type { Effect, PendingEvent } from "../../../bus/domain/transition.js";
import type { Caps } from "../../../shared/config.js";
import { BUILD_EFFECT_KINDS, FOREIGN_EFFECT_KINDS } from "../../effect-kinds.js";
import { integerField, numberOrNullField, stringOrNullField, stringsField } from "../payload.js";

export interface RuleDeps {
  readonly caps: Caps;
  readonly handoffsDir: string;
  readonly laneModel: string | null;
}

export interface ReworkFinding {
  readonly reason: string;
  readonly findingPath: string | null;
}

export class MissingTaskError extends Error {
  override readonly name = "MissingTaskError";
}

export function taskOf(state: RunState, taskId: string): TaskState {
  const task = state.tasks[taskId];
  if (task === undefined) {
    throw new MissingTaskError(taskId);
  }
  return task;
}

export function withTask(state: RunState, taskId: string, task: TaskState): RunState {
  return { ...state, tasks: { ...state.tasks, [taskId]: task } };
}

export function foreman(type: PendingEvent["type"], payload: EventPayload): PendingEvent {
  return { type, producer: "foreman", payload };
}

export function capExhausted(taskId: string, role: string): PendingEvent {
  return foreman("task.failed", { taskId, reason: "cap_exhausted", detail: role });
}

export function implementerRework(task: TaskState, taskId: string, caps: Caps, reason: string, findingPath: string | null): PendingEvent {
  if (task.attempts.implementer >= caps.implementerAttempts) {
    return capExhausted(taskId, "implementer");
  }
  return foreman("task.rework", { taskId, target: "implementer", attempt: task.attempts.implementer + 1, reason, findingPath });
}

export function testWriterRework(task: TaskState, taskId: string, reason: string, findingPath: string | null): PendingEvent {
  return foreman("task.rework", { taskId, target: "test-writer", attempt: task.attempts.testWriter + 1, reason, findingPath });
}

export function plannerRework(state: RunState, taskId: string, caps: Caps, reason: string, findingPath: string | null): PendingEvent {
  if (state.stageAttempts.plannerRecuts >= caps.plannerRecuts) {
    return capExhausted(taskId, "planner");
  }
  return foreman("task.rework", { taskId, target: "planner", attempt: state.stageAttempts.plannerRecuts + 1, reason, findingPath });
}

export function architectRework(state: RunState, taskId: string, caps: Caps, reason: string, findingPath: string | null): PendingEvent {
  if (state.stageAttempts.architectRepairs >= caps.architectRepairs) {
    return capExhausted(taskId, "architect");
  }
  return foreman("task.rework", { taskId, target: "architect", attempt: state.stageAttempts.architectRepairs + 1, reason, findingPath });
}

export function criticRework(state: RunState, taskId: string, caps: Caps, specIds: readonly string[], findingPath: string | null): PendingEvent {
  const minted = specIds.map((id) => state.assumptionsByRecord[id] ?? 0);
  if (minted.some((count) => count >= caps.criticAssumptionsPerId)) {
    return capExhausted(taskId, "critic");
  }
  return foreman("task.rework", { taskId, target: "critic", attempt: Math.max(0, ...minted) + 1, reason: "spec_contradiction", findingPath, specIds });
}

export function tasksCovering(state: RunState, specIds: readonly string[]): readonly string[] {
  return Object.entries(state.tasks)
    .filter(([, task]) => task.covers.some((id) => specIds.includes(id)))
    .map(([id]) => id)
    .sort();
}

export function costEntryOf(payload: EventPayload, participant: Producer, taskId: string, model: string | null): CostEntry {
  return {
    participant,
    taskId,
    stage: "build",
    costUsd: numberOrNullField(payload, "costUsd"),
    inputTokens: integerField(payload, "inputTokens"),
    outputTokens: integerField(payload, "outputTokens"),
    model: Object.hasOwn(payload, "model") ? stringOrNullField(payload, "model") : model,
    durationMs: integerField(payload, "durationMs"),
  };
}

export function hasCostFields(payload: EventPayload): boolean {
  return Object.hasOwn(payload, "inputTokens") && Object.hasOwn(payload, "durationMs");
}

export function laneEffect(kind: (typeof BUILD_EFFECT_KINDS)[keyof typeof BUILD_EFFECT_KINDS], fields: Readonly<Record<string, unknown>>): Effect {
  return { kind, ...fields };
}

export function specAssumeEffect(taskId: string, specIds: readonly string[], findingPath: string | null, taskIds: readonly string[]): Effect {
  return { kind: FOREIGN_EFFECT_KINDS.specAssume, taskId, specIds, findingPath, taskIds };
}

export function specIdsOf(payload: EventPayload): readonly string[] {
  return Object.hasOwn(payload, "specIds") ? stringsField(payload, "specIds") : [];
}
