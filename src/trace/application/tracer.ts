import { TERMINAL_EVENT_TYPES, type EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../bus/domain/envelope.js";
import type { RunStage } from "../../bus/domain/run-state.js";
import { dedupeKey, type PendingEvent } from "../../bus/domain/transition.js";
import type { ModelPricing } from "../../shared/config.js";
import { parseTasksJson } from "../../shared/design-files/tasks-json.js";
import { costOf, type TokenCounts } from "../../shared/llm/pricing.js";
import { assumptionsOf, type AssumptionNote } from "../domain/assumptions.js";
import { renderCostsJson } from "../domain/costs-json.js";
import { integerOf, numberOrNull, stringOf } from "../domain/guards.js";
import { interventionLine, isInterventionKind, LAUNCH_NOTE, midRunCountLine } from "../domain/interventions.js";
import type { TraceCostEntry } from "../domain/ledger.js";
import { buildReport, type TraceReport } from "../domain/report.js";
import { stageOpenedBy } from "../domain/stage.js";
import { renderTraceMd } from "../domain/trace-md.js";
import { RUNTIME_PRODUCER, serializeRecord, type RuntimeEventType, type TraceRecord } from "../domain/trace-record.js";
import type { ProductTextReader, TraceStore } from "../ports/outbound/trace-store.js";

export interface TracerDeps {
  readonly runId: string;
  readonly slug: string;
  readonly operator: string;
  readonly pricing: Readonly<Record<string, ModelPricing>>;
  readonly store: TraceStore;
  readonly readProductText: ProductTextReader;
  readonly now: () => Date;
  readonly publish: (pending: PendingEvent) => void;
  readonly log: (line: string) => void;
}

export interface RuntimeEventInput {
  readonly type: RuntimeEventType;
  readonly occurredAt: Date;
  readonly producerId: string;
  readonly participant: string;
  readonly loopId: string | null;
  readonly model: string | null;
  readonly tokenUsage: TokenCounts | null;
}

interface OpenInference {
  readonly startedAtMs: number;
  readonly model: string | null;
}

const REPORT_TRIGGERS: ReadonlySet<EventType> = new Set<EventType>([
  "workspace.ready",
  "spec.approved",
  "spec.blocked",
  "design.tasks.ready",
  "design.blocked",
  "task.approved",
  "task.failed",
  "assembly.verified",
  "run.published",
  "run.failed",
]);

const LANE_ROLE_BY_EVENT: Partial<Record<EventType, string>> = { "task.tests_written": "test-writer", "task.impl_done": "implementer" };

const ASSUMPTION_FILES = ["spec/spec.md", "spec/assumptions.md"] as const;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Tracer {
  private readonly records: TraceRecord[] = [];
  private readonly entries: TraceCostEntry[] = [];
  private readonly warnings: string[] = [];
  private readonly buffered: RuntimeEventInput[] = [];
  private readonly openInferences = new Map<string, OpenInference>();
  private readonly ledgerKeys = new Set<string>();
  private readonly awaitingReview: string[] = [];
  private readonly reviewerLanes = new Map<string, string>();
  private titles: Readonly<Record<string, string>> = {};
  private startedAtMs: number | null = null;
  private stage: RunStage = "workspace";
  private midRunInterventions = 0;
  private isBroken = false;
  private pendingWrites: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TracerDeps) {}

  recordBusEvent(event: DeliveredEvent<EventType>): void {
    const isTerminal = TERMINAL_EVENT_TYPES.includes(event.type);
    if (this.isBroken && !isTerminal) {
      return;
    }
    if (event.type === "run.started") {
      this.startedAtMs = Date.parse(event.occurredAt);
    }
    if (this.startedAtMs === null) {
      this.deps.log(`trace: ${event.type} before run.started dropped`);
      return;
    }
    const elapsedMs = Math.max(0, Date.parse(event.occurredAt) - this.startedAtMs);
    if (!this.commit({ elapsedMs, type: event.type, runId: event.runId, occurredAt: event.occurredAt, producer: event.producer, payload: event.payload })) {
      return;
    }
    if (event.type === "run.started") {
      this.onRunStarted(event);
    }
    this.stage = stageOpenedBy(event.type, event.payload) ?? this.stage;
    this.noteLaneCost(event);
    this.noteReviewCandidate(event);
    this.noteIntervention(event);
    this.noteTaskTitles(event);
    if (isTerminal) {
      this.write(() => this.deps.store.appendIntervention(midRunCountLine(this.midRunInterventions)));
    }
    if (REPORT_TRIGGERS.has(event.type)) {
      this.regenerate();
    }
  }

  recordRuntimeEvent(input: RuntimeEventInput): void {
    if (this.isBroken) {
      return;
    }
    if (this.startedAtMs === null) {
      this.buffered.push(input);
      return;
    }
    this.commitRuntime(input, this.startedAtMs);
  }

  idle(): Promise<void> {
    return this.pendingWrites;
  }

  async copyTo(destinationDir: string): Promise<void> {
    await this.pendingWrites;
    const report = this.report({ finishedAt: this.deps.now().toISOString() });
    await this.deps.store.publishTo(destinationDir, {
      traceMd: renderTraceMd(report),
      costsJson: renderCostsJson(report),
      interventionsTail: midRunCountLine(this.midRunInterventions),
    });
  }

  private commit(record: Omit<TraceRecord, "seq">): boolean {
    const sequenced: TraceRecord = { ...record, seq: this.records.length + 1 };
    const written = this.write(() => this.deps.store.appendRecord(serializeRecord(sequenced)));
    if (written) {
      this.records.push(sequenced);
    }
    return written;
  }

  private write(action: () => void): boolean {
    try {
      action();
      return true;
    } catch (error) {
      this.breakRun(error);
      return false;
    }
  }

  private breakRun(error: unknown): void {
    if (this.isBroken) {
      return;
    }
    this.isBroken = true;
    const detail = describe(error);
    this.deps.log(`trace_write_failed: ${detail}`);
    try {
      this.deps.publish({ type: "run.failed", producer: "tracer", payload: { stage: this.stage, reason: "trace_write_failed", detail } });
    } catch (publishError) {
      this.deps.log(`trace: run.failed not published: ${describe(publishError)}`);
    }
  }

  private onRunStarted(event: DeliveredEvent<EventType>): void {
    const operator = stringOf(event.payload["operator"]) ?? this.deps.operator;
    this.write(() => this.deps.store.createInterventions(interventionLine(event.occurredAt, "launch", operator, LAUNCH_NOTE)));
    const startedAtMs = Date.parse(event.occurredAt);
    for (const input of this.buffered.splice(0)) {
      this.commitRuntime(input, startedAtMs);
    }
  }

  private noteLaneCost(event: DeliveredEvent<EventType>): void {
    const role = LANE_ROLE_BY_EVENT[event.type];
    if (role === undefined) {
      return;
    }
    const key = dedupeKey(event) ?? `${event.type}|${event.seq}`;
    if (this.ledgerKeys.has(key)) {
      return;
    }
    this.ledgerKeys.add(key);
    this.entries.push({
      participant: role,
      taskId: stringOf(event.payload["taskId"]),
      stage: "build",
      costUsd: numberOrNull(event.payload["costUsd"]),
      inputTokens: integerOf(event.payload["inputTokens"]),
      outputTokens: integerOf(event.payload["outputTokens"]),
      model: null,
      durationMs: integerOf(event.payload["durationMs"]),
    });
  }

  /* The reviewer agent carries no task id; the next reviewer inference belongs to the oldest green-verified task. */
  private noteReviewCandidate(event: DeliveredEvent<EventType>): void {
    const taskId = stringOf(event.payload["taskId"]);
    if (event.type === "task.verified" && event.payload["result"] === "green" && taskId !== null) {
      this.awaitingReview.push(taskId);
    }
  }

  private noteIntervention(event: DeliveredEvent<EventType>): void {
    if (event.type !== "human.intervention") {
      return;
    }
    const kind = event.payload["kind"];
    if (!isInterventionKind(kind)) {
      return;
    }
    if (kind === "mid_run_nudge") {
      this.midRunInterventions += 1;
    }
    const line = interventionLine(event.occurredAt, kind, stringOf(event.payload["actor"]) ?? "", stringOf(event.payload["note"]) ?? "");
    this.write(() => this.deps.store.appendIntervention(line));
  }

  private noteTaskTitles(event: DeliveredEvent<EventType>): void {
    if (event.type !== "design.tasks.ready") {
      return;
    }
    const path = stringOf(event.payload["path"]) ?? "";
    const text = this.deps.readProductText(path);
    if (text === null) {
      this.warnings.push(`warning: tasks file ${path} not readable; task titles fall back to ids`);
      return;
    }
    try {
      this.titles = Object.fromEntries(parseTasksJson(text).tasks.map((task) => [task.id, task.title]));
    } catch (error) {
      this.warnings.push(`warning: tasks file ${path} invalid (${describe(error)}); task titles fall back to ids`);
    }
  }

  private commitRuntime(input: RuntimeEventInput, startedAtMs: number): void {
    const occurredAtMs = input.occurredAt.getTime();
    const inferenceKey = `${input.producerId}|${input.loopId ?? ""}`;
    const model = input.model ?? this.openInferences.get(inferenceKey)?.model ?? null;
    const payload: Record<string, unknown> = { participant: input.participant };
    if (model !== null) {
      payload["model"] = model;
    }
    if (input.tokenUsage !== null) {
      payload["tokenUsage"] = { inputTokens: input.tokenUsage.inputTokens, outputTokens: input.tokenUsage.outputTokens };
    }
    const record = {
      elapsedMs: Math.max(0, occurredAtMs - startedAtMs),
      type: input.type,
      runId: this.deps.runId,
      occurredAt: input.occurredAt.toISOString(),
      producer: RUNTIME_PRODUCER,
      payload,
    };
    if (!this.commit(record)) {
      return;
    }
    if (input.type === "inference.started") {
      this.openInference(input, inferenceKey, occurredAtMs);
    }
    if (input.type === "inference.completed") {
      this.closeInference(input, inferenceKey, model, occurredAtMs);
    }
  }

  private openInference(input: RuntimeEventInput, inferenceKey: string, occurredAtMs: number): void {
    this.openInferences.set(inferenceKey, { startedAtMs: occurredAtMs, model: input.model });
    if (input.participant === "reviewer" && !this.reviewerLanes.has(input.producerId)) {
      const taskId = this.awaitingReview.shift();
      if (taskId !== undefined) {
        this.reviewerLanes.set(input.producerId, taskId);
      }
    }
  }

  private closeInference(input: RuntimeEventInput, inferenceKey: string, model: string | null, occurredAtMs: number): void {
    const started = this.openInferences.get(inferenceKey);
    this.openInferences.delete(inferenceKey);
    const tokens: TokenCounts = input.tokenUsage ?? { inputTokens: 0, outputTokens: 0 };
    const costUsd = input.tokenUsage === null ? null : costOf(this.deps.pricing, model, tokens);
    if (input.tokenUsage === null) {
      this.warnings.push(`warning: no token usage for model ${model ?? "unknown"}`);
    } else if (costUsd === null) {
      this.warnings.push(`warning: no price for model ${model ?? "unknown"}`);
    }
    this.entries.push({
      participant: input.participant,
      taskId: this.reviewerLanes.get(input.producerId) ?? null,
      stage: this.stage,
      costUsd,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      model,
      durationMs: started === undefined ? 0 : Math.max(0, occurredAtMs - started.startedAtMs),
    });
  }

  private assumptions(): readonly AssumptionNote[] {
    return ASSUMPTION_FILES.flatMap((file) => {
      const text = this.deps.readProductText(file);
      return text === null ? [] : assumptionsOf(text);
    });
  }

  private report(finished: { readonly finishedAt: string } | null): TraceReport {
    return buildReport({
      runId: this.deps.runId,
      slug: this.deps.slug,
      operator: this.deps.operator,
      records: [...this.records],
      entries: [...this.entries],
      titles: this.titles,
      warnings: [...this.warnings],
      assumptions: this.assumptions(),
      midRunInterventions: this.midRunInterventions,
      pricing: this.deps.pricing,
      finished,
    });
  }

  private regenerate(): void {
    const report = this.report(null);
    const texts = { traceMd: renderTraceMd(report), costsJson: renderCostsJson(report) };
    this.pendingWrites = this.pendingWrites.then(() => this.deps.store.writeReports(texts)).catch((error: unknown) => this.breakRun(error));
  }
}
