import type { RunState, TaskState } from "../../../bus/domain/run-state.js";
import type { Effect, PendingEvent, TransitionResult } from "../../../bus/domain/transition.js";
import { ASSEMBLY_EFFECT } from "../effects.js";
import type { ReworkEntry, ReworkTarget, TriageEntry } from "../ledger.js";

export type AssemblyFailureReason = "cap_exhausted";

export function unchanged(state: RunState): TransitionResult {
  return { state, emits: [], effects: [] };
}

export function recordEffect(entries: { readonly triage?: readonly TriageEntry[]; readonly reworks?: readonly ReworkEntry[]; readonly failed?: string }): Effect {
  return { kind: ASSEMBLY_EFFECT.record, ...entries };
}

export function failedRun(state: RunState, reason: AssemblyFailureReason, detail: string, triage: readonly TriageEntry[] = []): TransitionResult {
  return {
    state,
    emits: [{ type: "run.failed", producer: "assembler", payload: { stage: "assembly", reason, detail } }],
    effects: [recordEffect({ triage, failed: `${reason}: ${detail}` })],
  };
}

export function nextAttempt(state: RunState, task: TaskState, target: ReworkTarget): number {
  switch (target) {
    case "implementer":
      return task.attempts.implementer + 1;
    case "test-writer":
      return task.attempts.testWriter + 1;
    case "planner":
      return state.stageAttempts.plannerRecuts + 1;
  }
}

export function reworkEvents(input: {
  readonly state: RunState;
  readonly round: number;
  readonly taskId: string;
  readonly target: ReworkTarget;
  readonly reason: string;
  readonly findingPath: string | null;
}): readonly PendingEvent[] {
  const task = input.state.tasks[input.taskId];
  if (task === undefined) {
    throw new Error(`rework for unknown task ${input.taskId}`);
  }
  return [
    { type: "assembly.rework", producer: "assembler", payload: { round: input.round, taskId: input.taskId, target: input.target } },
    {
      type: "task.rework",
      producer: "foreman",
      payload: { taskId: input.taskId, target: input.target, attempt: nextAttempt(input.state, task, input.target), reason: input.reason, findingPath: input.findingPath },
    },
  ];
}
