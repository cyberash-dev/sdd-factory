import type { EventType } from "./catalogue.js";
import type { DeliveredEvent, EventPayload, Producer } from "./envelope.js";
import type { RunState, RunStatus, TaskStatus } from "./run-state.js";

export interface PendingEvent<TType extends EventType = EventType> {
  readonly type: TType;
  readonly producer: Producer;
  readonly payload: EventPayload;
}

export type Effect = Readonly<{ kind: string } & Record<string, unknown>>;

export interface TransitionContext {
  readonly state: RunState;
  readonly event: DeliveredEvent<EventType>;
}

export interface TransitionResult {
  readonly state: RunState;
  readonly emits: readonly PendingEvent[];
  readonly effects: readonly Effect[];
}

export interface TransitionRule {
  readonly name: string;
  readonly eventType: EventType;
  readonly acceptsRunStatus?: readonly RunStatus[];
  readonly acceptsTaskStatus?: readonly TaskStatus[];
  apply(context: TransitionContext): TransitionResult;
}

export type ReduceOutcome =
  | { readonly kind: "applied"; readonly rule: string; readonly result: TransitionResult }
  | { readonly kind: "duplicate_ignored" }
  | { readonly kind: "out_of_order_ignored"; readonly rule: string }
  | { readonly kind: "unknown_task_ignored" }
  | { readonly kind: "no_rule" };

export function dedupeKey(event: DeliveredEvent): string | null {
  const counter = event.payload["attempt"] ?? event.payload["round"];
  if (typeof counter !== "number") {
    return null;
  }
  const taskId = typeof event.payload["taskId"] === "string" ? event.payload["taskId"] : "";
  return `${event.type}|${event.runId}|${taskId}|${counter}`;
}

function taskIdOf(event: DeliveredEvent): string | null {
  const taskId = event.payload["taskId"];
  return typeof taskId === "string" ? taskId : null;
}

function stamp(state: RunState, event: DeliveredEvent): RunState {
  return { ...state, updatedAt: event.occurredAt, lastSeq: event.seq };
}

export function reduce(
  rules: readonly TransitionRule[],
  state: RunState,
  event: DeliveredEvent<EventType>,
  consumedKeys: ReadonlySet<string>,
): ReduceOutcome {
  const key = dedupeKey(event);
  if (key !== null && consumedKeys.has(key)) {
    return { kind: "duplicate_ignored" };
  }
  const taskId = taskIdOf(event);
  if (taskId !== null && event.type !== "task.ready" && !Object.hasOwn(state.tasks, taskId)) {
    return { kind: "unknown_task_ignored" };
  }
  const rule = rules.find((candidate) => candidate.eventType === event.type);
  if (rule === undefined) {
    return { kind: "no_rule" };
  }
  if (rule.acceptsRunStatus !== undefined && !rule.acceptsRunStatus.includes(state.status)) {
    return { kind: "out_of_order_ignored", rule: rule.name };
  }
  if (rule.acceptsTaskStatus !== undefined) {
    const task = taskId === null ? undefined : state.tasks[taskId];
    if (task === undefined || !rule.acceptsTaskStatus.includes(task.status)) {
      return { kind: "out_of_order_ignored", rule: rule.name };
    }
  }
  const result = rule.apply({ state, event });
  return { kind: "applied", rule: rule.name, result: { ...result, state: stamp(result.state, event) } };
}
