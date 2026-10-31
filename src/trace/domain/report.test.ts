import { describe, expect, it } from "vitest";
import type { RunStage } from "../../bus/domain/run-state.js";
import { renderCostsJson } from "./costs-json.js";
import type { TraceCostEntry } from "./ledger.js";
import { buildReport, type ReportInput, type TraceReport } from "./report.js";
import { renderTraceMd } from "./trace-md.js";
import type { TraceRecord } from "./trace-record.js";

const RUN_ID = "todo-cli-20261029-120000";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const BASE = Date.parse("2026-10-29T12:00:00.000Z");

function record(seq: number, type: TraceRecord["type"], occurredAt: string, payload: Record<string, unknown> = {}, producer = "foreman"): TraceRecord {
  return { seq, elapsedMs: Date.parse(occurredAt) - BASE, type, runId: RUN_ID, occurredAt, producer, payload };
}

function entry(participant: string, taskId: string | null, stage: RunStage, costUsd: number | null, tokens = { inputTokens: 100, outputTokens: 10 }): TraceCostEntry {
  return { participant, taskId, stage, costUsd, ...tokens, model: participant === "implementer" || participant === "test-writer" ? null : "m", durationMs: 1000 };
}

function report(records: readonly TraceRecord[], entries: readonly TraceCostEntry[] = [], overrides: Partial<ReportInput> = {}): TraceReport {
  return buildReport({
    runId: RUN_ID,
    slug: "todo-cli",
    operator: "cyberash",
    records,
    entries,
    titles: { "T-001": "Domain model" },
    warnings: [],
    assumptions: [],
    midRunInterventions: 0,
    pricing: { m: { inputPerMillion: 3, outputPerMillion: 15 } },
    finished: null,
    cloudSessionUrl: null,
    earlierRuns: [],
    ...overrides,
  });
}

const started = record(1, "run.started", "2026-10-29T12:00:00.000Z", { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" });
const ready = (seq: number, at: string, taskId = "T-001"): TraceRecord => record(seq, "task.ready", at, { taskId, worktree: `/wt/${taskId}`, baseSha: SHA, covers: [], writes: [] });
const roleDone = (seq: number, type: "task.impl_done" | "task.tests_written", at: string, attempt: number): TraceRecord =>
  record(seq, type, at, { taskId: "T-001", attempt, handoffPath: "h.md", costUsd: null, inputTokens: 1, outputTokens: 1, durationMs: 1 }, type === "task.impl_done" ? "implementer" : "test-writer");

describe("task rows", () => {
  // @covers trace:BEH-002
  it("measures from the first task.ready to task.approved and takes attempts from the highest role attempt despite a lane restart", () => {
    const records = [
      started,
      ready(2, "2026-10-29T12:01:00.000Z"),
      roleDone(3, "task.tests_written", "2026-10-29T12:02:00.000Z", 1),
      roleDone(4, "task.impl_done", "2026-10-29T12:03:00.000Z", 1),
      ready(5, "2026-10-29T12:04:00.000Z"),
      roleDone(6, "task.tests_written", "2026-10-29T12:05:00.000Z", 2),
      roleDone(7, "task.impl_done", "2026-10-29T12:06:00.000Z", 2),
      record(8, "task.approved", "2026-10-29T12:07:30.000Z", { taskId: "T-001", implSha: SHA }),
    ];

    const { tasks } = report(records);

    expect(tasks).toEqual([{ taskId: "T-001", title: "Domain model", attempts: { implementer: 2, testWriter: 2 }, durationMs: 390000, costUsd: 0, inputTokens: 0, outputTokens: 0, models: [], outcome: "approved" }]);
  });

  // @covers trace:BEH-002
  it("reports an unfinished task as in_progress with the time elapsed since its first task.ready", () => {
    const records = [started, ready(2, "2026-10-29T12:01:00.000Z"), roleDone(3, "task.impl_done", "2026-10-29T12:03:00.000Z", 1)];

    const { tasks } = report(records);

    expect([tasks[0]?.durationMs, tasks[0]?.attempts, tasks[0]?.outcome]).toEqual([120000, { implementer: 1, testWriter: 0 }, "in_progress"]);
  });

  // @covers trace:BEH-002
  it("reports a single-attempt task that failed with outcome failed", () => {
    const records = [started, ready(2, "2026-10-29T12:01:00.000Z"), roleDone(3, "task.tests_written", "2026-10-29T12:02:00.000Z", 1), record(4, "task.failed", "2026-10-29T12:02:30.000Z", { taskId: "T-001", reason: "cap_exhausted", detail: "x" })];

    const { tasks } = report(records);

    expect([tasks[0]?.durationMs, tasks[0]?.attempts, tasks[0]?.outcome]).toEqual([90000, { implementer: 0, testWriter: 1 }, "failed"]);
  });
});

describe("stage rows", () => {
  // @covers trace:BEH-003
  it("bounds each stage from its first event to the later of its last event and the opening event of the next stage", () => {
    const records = [
      started,
      record(2, "workspace.ready", "2026-10-29T12:00:10.000Z"),
      record(3, "spec.drafted", "2026-10-29T12:01:00.000Z"),
      record(4, "spec.approved", "2026-10-29T12:02:00.000Z"),
      record(5, "design.tech.ready", "2026-10-29T12:05:00.000Z"),
      record(6, "design.tasks.ready", "2026-10-29T12:06:00.000Z"),
      ready(7, "2026-10-29T12:07:00.000Z"),
      record(8, "task.approved", "2026-10-29T12:09:00.000Z", { taskId: "T-001", implSha: SHA }),
      record(9, "assembly.started", "2026-10-29T12:10:00.000Z"),
      record(10, "assembly.verified", "2026-10-29T12:11:00.000Z"),
      record(11, "run.published", "2026-10-29T12:12:00.000Z", { commitSha: SHA, outputDir: "hidden/todo-cli", pushed: true }),
    ];

    const { stages, totals } = report(records);

    expect([stages.map((row) => [row.stage, row.startedAt, row.endedAt, row.durationMs]), totals.durationMs]).toEqual([
      [
        ["workspace", "2026-10-29T12:00:00.000Z", "2026-10-29T12:01:00.000Z", 60000],
        ["spec", "2026-10-29T12:01:00.000Z", "2026-10-29T12:05:00.000Z", 240000],
        ["design", "2026-10-29T12:05:00.000Z", "2026-10-29T12:07:00.000Z", 120000],
        ["build", "2026-10-29T12:07:00.000Z", "2026-10-29T12:10:00.000Z", 180000],
        ["assembly", "2026-10-29T12:10:00.000Z", "2026-10-29T12:12:00.000Z", 120000],
        ["publish", "2026-10-29T12:12:00.000Z", "2026-10-29T12:12:00.000Z", 0],
      ],
      720000,
    ]);
  });

  // @covers trace:BEH-003
  it("has no build or assembly rows for a run that failed in design", () => {
    const records = [
      started,
      record(2, "workspace.ready", "2026-10-29T12:00:10.000Z"),
      record(3, "spec.approved", "2026-10-29T12:02:00.000Z"),
      record(4, "run.failed", "2026-10-29T12:04:00.000Z", { stage: "design", reason: "design_blocked", detail: "no tasks" }),
    ];

    const { stages, outcome } = report(records);

    expect([stages.map((row) => row.stage), outcome]).toEqual([["workspace", "spec", "design"], { kind: "failed", stage: "design", reason: "design_blocked" }]);
  });

  // @covers trace:BEH-003
  it("extends an earlier stage when one of its events arrives after the next stage opened", () => {
    const records = [
      started,
      record(2, "design.tasks.ready", "2026-10-29T12:06:00.000Z"),
      ready(3, "2026-10-29T12:07:00.000Z"),
      record(4, "assembly.started", "2026-10-29T12:10:00.000Z"),
      record(5, "task.reviewed", "2026-10-29T12:10:30.000Z", { taskId: "T-001", decision: "advisory_only", target: "none", reportPath: "r.md" }),
    ];

    const { stages } = report(records);

    expect(stages.find((row) => row.stage === "build")?.endedAt).toBe("2026-10-29T12:10:30.000Z");
  });
});

describe("costs.json ledger", () => {
  const laneRecords = [
    started,
    record(2, "workspace.ready", "2026-10-29T12:00:10.000Z"),
    record(3, "design.tasks.ready", "2026-10-29T12:06:00.000Z"),
    ready(4, "2026-10-29T12:07:00.000Z"),
    record(5, "task.approved", "2026-10-29T12:09:00.000Z", { taskId: "T-001", implSha: SHA }),
  ];

  // @covers trace:CTR-004
  it("sums entries of 0.01, null and 0.02 to 0.03 with one unknown entry, matched by the per-task and per-stage sums", () => {
    const entries = [entry("test-writer", "T-001", "build", 0.01), entry("implementer", "T-001", "build", null), entry("reviewer", "T-001", "build", 0.02)];

    const costs: { schemaVersion: number; runId: string; pricing: unknown; totals: Record<string, number>; tasks: { costUsd: number }[]; stages: { stage: string; costUsd: number }[] } = JSON.parse(
      renderCostsJson(report(laneRecords, entries)),
    );

    expect([costs.schemaVersion, costs.runId, costs.pricing, costs.totals, costs.tasks.map((task) => task.costUsd), costs.stages.map((row) => [row.stage, row.costUsd])]).toEqual([
      1,
      RUN_ID,
      { m: { inputPerMTok: 3, outputPerMTok: 15 } },
      { durationMs: 540000, costUsd: 0.03, inputTokens: 300, outputTokens: 30, unknownCostEntries: 1 },
      [0.03],
      [
        ["workspace", 0],
        ["design", 0],
        ["build", 0.03],
      ],
    ]);
  });

  // @covers trace:CTR-004
  it("keeps an entry with taskId null out of task sums but inside its stage and the totals", () => {
    const entries = [entry("spec-analyst", null, "spec", 0.05), entry("implementer", "T-001", "build", 0.01)];
    const records = [...laneRecords.slice(0, 2), record(3, "spec.approved", "2026-10-29T12:02:00.000Z"), ...laneRecords.slice(2)];

    const { totals, tasks, stages } = report(records, entries);

    expect([totals.costUsd, tasks.map((task) => task.costUsd), stages.map((row) => [row.stage, row.costUsd])]).toEqual([
      0.06,
      [0.01],
      [
        ["workspace", 0],
        ["spec", 0.05],
        ["design", 0],
        ["build", 0.01],
      ],
    ]);
  });
});

function seeded(seed: number): () => number {
  let state = seed * 2654435761 + 1;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomLedger(seed: number): readonly TraceCostEntry[] {
  const random = seeded(seed);
  const stages: readonly RunStage[] = ["workspace", "spec", "design", "build"];
  const taskIds = ["T-001", "T-002", null];
  const count = 1 + Math.floor(random() * 12);
  return Array.from({ length: count }, (_, index) => {
    const stage = stages[Math.floor(random() * stages.length)] ?? "build";
    const taskId = taskIds[Math.floor(random() * taskIds.length)] ?? null;
    const costUsd = random() < 0.3 ? null : Math.round(random() * 1_000_000) / 1_000_000;
    return entry(`participant-${index}`, taskId, stage, costUsd);
  });
}

function sumOf(values: readonly (number | null)[]): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

describe("totals consistency", () => {
  const records = [
    started,
    record(2, "workspace.ready", "2026-10-29T12:00:10.000Z"),
    record(3, "spec.approved", "2026-10-29T12:02:00.000Z"),
    record(4, "design.tasks.ready", "2026-10-29T12:06:00.000Z"),
    ready(5, "2026-10-29T12:07:00.000Z"),
    ready(6, "2026-10-29T12:07:01.000Z", "T-002"),
  ];

  // @covers trace:INV-002
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])("agrees between entries, tasks, stages and the trace.md Totals line for random ledger %i", (seed) => {
    const entries = randomLedger(seed);

    const built = report(records, entries);
    const traceMd = renderTraceMd(built);

    const byEntries = sumOf(entries.map((item) => item.costUsd));
    const byTasks = sumOf(built.tasks.map((task) => task.costUsd)) + sumOf(entries.filter((item) => item.taskId === null).map((item) => item.costUsd));
    const byStages = sumOf(built.stages.map((row) => row.costUsd));
    expect([
      Math.abs(built.totals.costUsd - byEntries) < 1e-6,
      Math.abs(built.totals.costUsd - byTasks) < 1e-6,
      Math.abs(built.totals.costUsd - byStages) < 1e-6,
      traceMd.includes(`- costUsd: ${built.totals.costUsd.toFixed(4)}`),
      built.totals.unknownCostEntries,
    ]).toEqual([true, true, true, true, entries.filter((item) => item.costUsd === null).length]);
  });

  // @covers trace:INV-002
  it("treats an all-null ledger as zero totals with every entry unknown", () => {
    const entries = [entry("implementer", "T-001", "build", null), entry("spec-analyst", null, "spec", null)];

    const built = report(records, entries);

    expect([built.totals.costUsd, built.totals.unknownCostEntries, built.tasks[0]?.costUsd, built.stages.find((row) => row.stage === "spec")?.costUsd]).toEqual([0, 2, null, null]);
  });
});
