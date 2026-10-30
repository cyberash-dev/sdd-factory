import { isEventType, RUN_STAGES, type EventType } from "../../bus/domain/catalogue.js";
import type { RunStage } from "../../bus/domain/run-state.js";
import type { ModelPricing } from "../../shared/config.js";
import type { AssumptionNote } from "./assumptions.js";
import { integerOf, millisOf, stringOf } from "./guards.js";
import { aggregateCost, type TraceCostEntry } from "./ledger.js";
import { stageOfEvent } from "./stage.js";
import type { TraceRecord } from "./trace-record.js";

export type TaskOutcome = "approved" | "failed" | "in_progress";

export type RunOutcome =
  | { readonly kind: "published" }
  | { readonly kind: "failed"; readonly stage: string; readonly reason: string }
  | { readonly kind: "in_progress" };

export interface StageRow {
  readonly stage: RunStage;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TaskRow {
  readonly taskId: string;
  readonly title: string;
  readonly attempts: { readonly implementer: number; readonly testWriter: number };
  readonly durationMs: number;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly models: readonly string[];
  readonly outcome: TaskOutcome;
}

export interface ParticipantRow {
  readonly name: string;
  readonly inferences: number;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ReportTotals {
  readonly durationMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly unknownCostEntries: number;
}

export interface TraceReport {
  readonly runId: string;
  readonly slug: string;
  readonly operator: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: RunOutcome;
  readonly pricing: Readonly<Record<string, ModelPricing>>;
  readonly stages: readonly StageRow[];
  readonly tasks: readonly TaskRow[];
  readonly participants: readonly ParticipantRow[];
  readonly entries: readonly TraceCostEntry[];
  readonly totals: ReportTotals;
  readonly assumptions: readonly AssumptionNote[];
  readonly midRunInterventions: number;
  readonly warnings: readonly string[];
  readonly cloudSessionUrl: string | null;
}

export interface ReportInput {
  readonly runId: string;
  readonly slug: string;
  readonly operator: string;
  readonly records: readonly TraceRecord[];
  readonly entries: readonly TraceCostEntry[];
  readonly titles: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
  readonly assumptions: readonly AssumptionNote[];
  readonly midRunInterventions: number;
  readonly pricing: Readonly<Record<string, ModelPricing>>;
  /* Set by the publish step: the copy is written before run.published is recorded. */
  readonly finished: { readonly finishedAt: string } | null;
  readonly cloudSessionUrl: string | null;
}

export class TraceReportError extends Error {
  override readonly name = "TraceReportError";
}

type BusRecord = TraceRecord & { readonly type: EventType };

function isBusRecord(record: TraceRecord): record is BusRecord {
  return isEventType(record.type);
}

function outcomeOf(bus: readonly BusRecord[], finished: ReportInput["finished"]): { readonly outcome: RunOutcome; readonly finishedAt: string | null } {
  if (finished !== null) {
    return { outcome: { kind: "published" }, finishedAt: finished.finishedAt };
  }
  const terminal = bus.find((record) => record.type === "run.published" || record.type === "run.failed");
  if (terminal === undefined) {
    return { outcome: { kind: "in_progress" }, finishedAt: null };
  }
  if (terminal.type === "run.published") {
    return { outcome: { kind: "published" }, finishedAt: terminal.occurredAt };
  }
  return {
    outcome: { kind: "failed", stage: stringOf(terminal.payload["stage"]) ?? "", reason: stringOf(terminal.payload["reason"]) ?? "" },
    finishedAt: terminal.occurredAt,
  };
}

interface StageBounds {
  readonly stage: RunStage;
  readonly startedAt: string;
  readonly lastAt: string;
}

function laterOf(left: string, right: string | null): string {
  return right !== null && millisOf(right) > millisOf(left) ? right : left;
}

function stageRows(bus: readonly BusRecord[], entries: readonly TraceCostEntry[]): readonly StageRow[] {
  const bounds = new Map<RunStage, StageBounds>();
  for (const record of bus) {
    const stage = stageOfEvent(record.type, record.payload);
    if (stage === null) {
      continue;
    }
    const known = bounds.get(stage);
    bounds.set(stage, known === undefined ? { stage, startedAt: record.occurredAt, lastAt: record.occurredAt } : { ...known, lastAt: record.occurredAt });
  }
  const present = RUN_STAGES.flatMap((stage) => {
    const found = bounds.get(stage);
    return found === undefined ? [] : [found];
  });
  return present.map((current, index) => {
    const next = present[index + 1];
    const endedAt = laterOf(current.lastAt, next === undefined ? null : next.startedAt);
    const cost = aggregateCost(entries.filter((entry) => entry.stage === current.stage));
    return {
      stage: current.stage,
      startedAt: current.startedAt,
      endedAt,
      durationMs: millisOf(endedAt) - millisOf(current.startedAt),
      costUsd: cost.costUsd,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
    };
  });
}

interface TaskFacts {
  readonly taskId: string;
  readonly readyAt: string;
  finishedAt: string | null;
  outcome: TaskOutcome;
  implementer: number;
  testWriter: number;
}

function taskFacts(bus: readonly BusRecord[]): readonly TaskFacts[] {
  const facts = new Map<string, TaskFacts>();
  for (const record of bus) {
    const taskId = stringOf(record.payload["taskId"]);
    if (taskId === null) {
      continue;
    }
    if (record.type === "task.ready") {
      if (!facts.has(taskId)) {
        facts.set(taskId, { taskId, readyAt: record.occurredAt, finishedAt: null, outcome: "in_progress", implementer: 0, testWriter: 0 });
      }
      continue;
    }
    const fact = facts.get(taskId);
    if (fact === undefined) {
      continue;
    }
    const attempt = integerOf(record.payload["attempt"]);
    if (record.type === "task.impl_done") {
      fact.implementer = Math.max(fact.implementer, attempt);
    }
    if (record.type === "task.tests_written") {
      fact.testWriter = Math.max(fact.testWriter, attempt);
    }
    if ((record.type === "task.approved" || record.type === "task.failed") && fact.finishedAt === null) {
      fact.finishedAt = record.occurredAt;
      fact.outcome = record.type === "task.approved" ? "approved" : "failed";
    }
  }
  return [...facts.values()];
}

function taskRows(bus: readonly BusRecord[], entries: readonly TraceCostEntry[], titles: Readonly<Record<string, string>>, nowAt: string): readonly TaskRow[] {
  return taskFacts(bus).map((fact) => {
    const taskEntries = entries.filter((entry) => entry.taskId === fact.taskId);
    const cost = aggregateCost(taskEntries);
    const models = [...new Set(taskEntries.flatMap((entry) => (entry.model === null ? [] : [entry.model])))];
    return {
      taskId: fact.taskId,
      title: titles[fact.taskId] ?? fact.taskId,
      attempts: { implementer: fact.implementer, testWriter: fact.testWriter },
      durationMs: millisOf(fact.finishedAt ?? nowAt) - millisOf(fact.readyAt),
      costUsd: cost.costUsd,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      models,
      outcome: fact.outcome,
    };
  });
}

function participantRows(entries: readonly TraceCostEntry[]): readonly ParticipantRow[] {
  const names = [...new Set(entries.map((entry) => entry.participant))];
  return names.map((name) => {
    const own = entries.filter((entry) => entry.participant === name);
    const cost = aggregateCost(own);
    return { name, inferences: own.length, costUsd: cost.costUsd, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens };
  });
}

export function buildReport(input: ReportInput): TraceReport {
  const bus = input.records.filter(isBusRecord);
  const started = bus.find((record) => record.type === "run.started");
  const last = input.records.at(-1);
  if (started === undefined || last === undefined) {
    throw new TraceReportError("run.started has not been recorded");
  }
  const { outcome, finishedAt } = outcomeOf(bus, input.finished);
  const nowAt = finishedAt ?? last.occurredAt;
  const cost = aggregateCost(input.entries);
  return {
    runId: input.runId,
    slug: input.slug,
    operator: input.operator,
    startedAt: started.occurredAt,
    finishedAt,
    outcome,
    pricing: input.pricing,
    stages: stageRows(bus, input.entries),
    tasks: taskRows(bus, input.entries, input.titles, nowAt),
    participants: participantRows(input.entries),
    entries: input.entries,
    totals: {
      durationMs: millisOf(nowAt) - millisOf(started.occurredAt),
      costUsd: cost.costUsd ?? 0,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      unknownCostEntries: cost.unknownCostEntries,
    },
    assumptions: input.assumptions,
    midRunInterventions: input.midRunInterventions,
    warnings: input.warnings,
    cloudSessionUrl: input.cloudSessionUrl,
  };
}
