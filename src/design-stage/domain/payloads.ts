import type { EventPayload, Producer } from "../../bus/domain/envelope.js";
import type { CostEntry, CostLedger, RunState } from "../../bus/domain/run-state.js";
import { withCostEntry } from "../../bus/domain/run-state.js";

export interface TaskSummary {
  readonly id: string;
  readonly covers: readonly string[];
  readonly writes: readonly string[];
  readonly dependsOn: readonly string[];
}

export interface RoleUsage {
  readonly model: string;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTaskSummary(value: unknown): value is TaskSummary {
  return isRecord(value) && typeof value["id"] === "string" && isStringArray(value["covers"]) && isStringArray(value["writes"]) && isStringArray(value["dependsOn"]);
}

export function taskSummariesOf(payload: EventPayload): readonly TaskSummary[] {
  const tasks = payload["tasks"];
  if (!Array.isArray(tasks) || !tasks.every(isTaskSummary)) {
    throw new Error("design.tasks.ready payload.tasks must be [{id, covers, writes, dependsOn}]");
  }
  return tasks;
}

export function stringListOf(payload: EventPayload, field: string): readonly string[] {
  const value = payload[field];
  return isStringArray(value) ? value : [];
}

export function stringOf(payload: EventPayload, field: string): string {
  const value = payload[field];
  return typeof value === "string" ? value : "";
}

export function integerOf(payload: EventPayload, field: string): number {
  const value = payload[field];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

export function usageOf(payload: EventPayload): RoleUsage | null {
  const usage = payload["usage"];
  if (!isRecord(usage)) {
    return null;
  }
  const { model, costUsd, inputTokens, outputTokens, durationMs } = usage;
  if (typeof model !== "string" || (costUsd !== null && typeof costUsd !== "number") || typeof inputTokens !== "number" || typeof outputTokens !== "number" || typeof durationMs !== "number") {
    return null;
  }
  return { model, costUsd, inputTokens, outputTokens, durationMs };
}

export function ledgerWithUsage(ledger: CostLedger, payload: EventPayload, participant: Producer): CostLedger {
  const usage = usageOf(payload);
  if (usage === null) {
    return ledger;
  }
  const entry: CostEntry = { participant, taskId: null, stage: "design", costUsd: usage.costUsd, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, model: usage.model, durationMs: usage.durationMs };
  return withCostEntry(ledger, entry);
}

export function withStageReruns(state: RunState, role: string, reruns: number): RunState["stageHandoffReruns"] {
  if (reruns === 0) {
    return state.stageHandoffReruns;
  }
  return { ...state.stageHandoffReruns, [role]: (state.stageHandoffReruns[role] ?? 0) + reruns };
}
