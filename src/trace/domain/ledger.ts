import type { RunStage } from "../../bus/domain/run-state.js";

export interface TraceCostEntry {
  readonly participant: string;
  readonly taskId: string | null;
  readonly stage: RunStage;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string | null;
  readonly durationMs: number;
}

export interface CostAggregate {
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly unknownCostEntries: number;
}

export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/* null only when every entry is unpriced; a null entry contributes 0 to the sum. */
export function aggregateCost(entries: readonly TraceCostEntry[]): CostAggregate {
  const priced = entries.filter((entry) => entry.costUsd !== null);
  const costUsd = entries.length > 0 && priced.length === 0 ? null : roundUsd(priced.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0));
  return {
    costUsd,
    inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens, 0),
    outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
    unknownCostEntries: entries.length - priced.length,
  };
}
