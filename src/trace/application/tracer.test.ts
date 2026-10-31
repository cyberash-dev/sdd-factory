import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload, Producer } from "../../bus/domain/envelope.js";
import { TraceFiles } from "../adapters/outbound/trace-files.js";
import { createRedactor } from "../domain/redaction.js";
import { Tracer } from "./tracer.js";

const RUN_ID = "todo-cli-20261029-120000";
const SHA = "0123456789abcdef0123456789abcdef01234567";

async function tracerInTempDir(): Promise<{ readonly tracer: Tracer; readonly dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tracer-"));
  const tracer = new Tracer({
    runId: RUN_ID,
    slug: "todo-cli",
    operator: "cyberash",
    pricing: {},
    store: new TraceFiles(dir, createRedactor([])),
    readProductText: () => null,
    readEarlierRuns: () => [],
    now: () => new Date("2026-10-29T12:10:00.000Z"),
    publish: () => undefined,
    log: () => undefined,
  });
  return { tracer, dir };
}

function delivered(seq: number, type: EventType, producer: Producer, payload: EventPayload): DeliveredEvent<EventType> {
  return { type, runId: RUN_ID, occurredAt: `2026-10-29T12:0${seq}:00.000Z`, producer, payload, seq };
}

function laneDone(seq: number, costUsd: number | null): DeliveredEvent<EventType> {
  return delivered(seq, "task.impl_done", "implementer", { taskId: "T-001", attempt: 1, handoffPath: "h.md", costUsd, inputTokens: 100, outputTokens: 10, durationMs: 1000 });
}

function typeOf(parsed: unknown): string {
  return typeof parsed === "object" && parsed !== null && "type" in parsed && typeof parsed.type === "string" ? parsed.type : "";
}

function startLane(tracer: Tracer): void {
  tracer.recordBusEvent(delivered(1, "run.started", "foreman", { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" }));
  tracer.recordBusEvent(delivered(2, "task.ready", "foreman", { taskId: "T-001", worktree: "/wt/T-001", baseSha: SHA, covers: [], writes: [] }));
}

interface CostsFile {
  readonly entries: readonly { participant: string; taskId: string | null; stage: string; costUsd: number | null; inputTokens: number; outputTokens: number; model: string | null; durationMs: number }[];
}

describe("Tracer lane cost entries", () => {
  // @covers trace:DLT-003
  // @covers trace:BEH-004
  // @covers trace:BEH-005
  it("records a lane's inference events in the trace without pricing them, so the task is costed once from its lane event", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startLane(tracer);
    const lane = { producerId: "lane-1", participant: "implementer", taskId: "T-001", loopId: null, isLane: true } as const;
    tracer.recordRuntimeEvent({ ...lane, type: "inference.started", occurredAt: new Date("2026-10-29T12:03:00.000Z"), model: "claude-code", tokenUsage: null });
    tracer.recordRuntimeEvent({ ...lane, type: "inference.completed", occurredAt: new Date("2026-10-29T12:04:00.000Z"), model: "claude-opus-5-5", tokenUsage: { inputTokens: 500, outputTokens: 120 } });
    tracer.recordBusEvent(laneDone(5, 0.42));
    tracer.recordBusEvent(delivered(6, "task.approved", "foreman", { taskId: "T-001", implSha: SHA }));
    await tracer.idle();

    const costs: CostsFile = JSON.parse(await readFile(join(dir, "costs.json"), "utf8"));
    const traceTypes = (await readFile(join(dir, "trace.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0).map((line) => typeOf(JSON.parse(line)));
    const traceMd = await readFile(join(dir, "trace.md"), "utf8");
    expect([costs.entries.map((entry) => [entry.participant, entry.taskId, entry.costUsd]), traceTypes.filter((type) => type.startsWith("inference")), traceMd.includes("no price for model")]).toEqual([[["implementer", "T-001", 0.42]], ["inference.started", "inference.completed"], false]);
  });

  // @covers trace:BEH-005
  it("copies costUsd 0.42 from task.impl_done into one entry for the implementer with model null and stage build", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startLane(tracer);

    tracer.recordBusEvent(laneDone(3, 0.42));
    tracer.recordBusEvent(delivered(4, "task.approved", "foreman", { taskId: "T-001", implSha: SHA }));
    await tracer.idle();

    const costs: CostsFile = JSON.parse(await readFile(join(dir, "costs.json"), "utf8"));
    expect(costs.entries).toEqual([{ participant: "implementer", taskId: "T-001", stage: "build", costUsd: 0.42, inputTokens: 100, outputTokens: 10, model: null, durationMs: 1000 }]);
  });

  // @covers trace:BEH-005
  it("records a duplicate delivery of the same task.impl_done as a trace line but not as a second entry", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startLane(tracer);

    tracer.recordBusEvent(laneDone(3, 0.42));
    tracer.recordBusEvent({ ...laneDone(3, 0.42), seq: 4 });
    tracer.recordBusEvent(delivered(5, "task.approved", "foreman", { taskId: "T-001", implSha: SHA }));
    await tracer.idle();

    const costs: CostsFile = JSON.parse(await readFile(join(dir, "costs.json"), "utf8"));
    const implLines = (await readFile(join(dir, "trace.jsonl"), "utf8")).split("\n").filter((line) => line.includes('"type":"task.impl_done"'));
    expect([costs.entries.length, implLines.length]).toEqual([1, 2]);
  });

  // @covers trace:BEH-005
  it("reports a task whose lane payloads carry costUsd null as n/a with its token counts", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startLane(tracer);

    tracer.recordBusEvent(delivered(3, "task.tests_written", "test-writer", { taskId: "T-001", attempt: 1, handoffPath: "h.md", costUsd: null, inputTokens: 100, outputTokens: 10, durationMs: 1000 }));
    tracer.recordBusEvent(laneDone(4, null));
    tracer.recordBusEvent(delivered(5, "task.approved", "foreman", { taskId: "T-001", implSha: SHA }));
    await tracer.idle();

    const row = (await readFile(join(dir, "trace.md"), "utf8")).split("\n").find((line) => line.startsWith("| T-001 |"));
    expect(row).toBe("| T-001 | T-001 | 1 | 1 | 180000 | n/a | 200 | 20 | approved | 0 |");
  });
});

function fixAttempted(seq: number, payload: { readonly stage: string; readonly taskId: string | null; readonly unit: string; readonly costUsd: number | null }): DeliveredEvent<EventType> {
  return delivered(seq, "fix.attempted", "simple-fixer", {
    ...payload,
    owner: payload.taskId === null ? "assembler" : "implementer",
    trigger: payload.taskId === null ? "assembly_typecheck" : "green_typecheck",
    attempt: 1,
    outcome: "fixed",
    filesChanged: ["src/a.ts", "src/b.ts"],
    answerPath: `handoffs/${payload.unit}/simple-fixer/answer-run1.md`,
    inputTokens: 300,
    outputTokens: 40,
    durationMs: 2000,
  });
}

function startTask(tracer: Tracer, taskId: string): void {
  tracer.recordBusEvent(delivered(1, "run.started", "foreman", { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" }));
  tracer.recordBusEvent(delivered(2, "task.ready", "foreman", { taskId, worktree: `/wt/${taskId}`, baseSha: SHA, covers: [], writes: [] }));
}

describe("Tracer simple-fixer runs", () => {
  // @covers trace:DLT-004
  // @covers trace:BEH-005
  it("copies a fix.attempted with costUsd 0.07 for T-002 into one simple-fixer entry with model null and the payload values verbatim", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startTask(tracer, "T-002");

    tracer.recordBusEvent(fixAttempted(3, { stage: "build", taskId: "T-002", unit: "T-002", costUsd: 0.07 }));
    tracer.recordBusEvent(delivered(4, "task.approved", "foreman", { taskId: "T-002", implSha: SHA }));
    await tracer.idle();

    const costs: CostsFile = JSON.parse(await readFile(join(dir, "costs.json"), "utf8"));
    expect(costs.entries).toEqual([{ participant: "simple-fixer", taskId: "T-002", stage: "build", costUsd: 0.07, inputTokens: 300, outputTokens: 40, model: null, durationMs: 2000 }]);
  });

  // @covers trace:DLT-004
  // @covers trace:BEH-005
  it("records a duplicate delivery of the same fix.attempted as no second entry and no second fix line", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startTask(tracer, "T-002");

    tracer.recordBusEvent(fixAttempted(3, { stage: "build", taskId: "T-002", unit: "T-002", costUsd: 0.07 }));
    tracer.recordBusEvent({ ...fixAttempted(3, { stage: "build", taskId: "T-002", unit: "T-002", costUsd: 0.07 }), seq: 4 });
    tracer.recordBusEvent(delivered(5, "task.approved", "foreman", { taskId: "T-002", implSha: SHA }));
    await tracer.idle();

    const costs: CostsFile = JSON.parse(await readFile(join(dir, "costs.json"), "utf8"));
    const fixLines = (await readFile(join(dir, "trace.md"), "utf8")).split("\n").filter((line) => line.startsWith("- fix "));
    expect([costs.entries.length, fixLines.length]).toEqual([1, 1]);
  });

  // @covers trace:DLT-004
  // @covers trace:CTR-002
  it("shows 1 in the fixes column of T-002, lists the fix in the T-002 section and keeps the totals equal to the ledger sum", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startTask(tracer, "T-002");

    tracer.recordBusEvent(delivered(3, "task.impl_done", "implementer", { taskId: "T-002", attempt: 1, handoffPath: "h.md", costUsd: 0.42, inputTokens: 100, outputTokens: 10, durationMs: 1000 }));
    tracer.recordBusEvent(fixAttempted(4, { stage: "build", taskId: "T-002", unit: "T-002", costUsd: 0.07 }));
    tracer.recordBusEvent(delivered(5, "task.approved", "foreman", { taskId: "T-002", implSha: SHA }));
    await tracer.idle();

    const traceMd = await readFile(join(dir, "trace.md"), "utf8");
    const row = traceMd.split("\n").find((line) => line.startsWith("| T-002 |"));
    expect([row, traceMd.includes("## Task T-002\n\n- fix 1 green_typecheck -> fixed (2 files, 0.0700)\n"), traceMd.includes("- costUsd: 0.4900\n")]).toEqual([
      "| T-002 | T-002 | 1 | 0 | 180000 | 0.4900 | 400 | 50 | approved | 1 |",
      true,
      true,
    ]);
  });

  // @covers trace:DLT-004
  // @covers trace:CTR-002
  it("lists an assembly fix with taskId null in the assembly stage section", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startTask(tracer, "T-001");

    tracer.recordBusEvent(delivered(3, "assembly.started", "foreman", {}));
    tracer.recordBusEvent(fixAttempted(4, { stage: "assembly", taskId: null, unit: "assembly", costUsd: null }));
    tracer.recordBusEvent(delivered(5, "assembly.verified", "assembler", { commitSha: SHA }));
    await tracer.idle();

    const traceMd = await readFile(join(dir, "trace.md"), "utf8");
    const costs: CostsFile = JSON.parse(await readFile(join(dir, "costs.json"), "utf8"));
    expect([traceMd.includes("## Stage assembly\n\n- fix 1 assembly_typecheck -> fixed (2 files, n/a)\n"), costs.entries.map((entry) => [entry.participant, entry.taskId, entry.stage])]).toEqual([
      true,
      [["simple-fixer", null, "assembly"]],
    ]);
  });

  // @covers trace:DLT-004
  // @covers trace:CTR-002
  it("renders a run without fixer events with a zero fixes column and no fix sections", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startTask(tracer, "T-001");

    tracer.recordBusEvent(laneDone(3, 0.42));
    tracer.recordBusEvent(delivered(4, "task.approved", "foreman", { taskId: "T-001", implSha: SHA }));
    await tracer.idle();

    const traceMd = await readFile(join(dir, "trace.md"), "utf8");
    const row = traceMd.split("\n").find((line) => line.startsWith("| T-001 |"));
    expect([row, traceMd.endsWith("## Warnings\n\nnone\n")]).toEqual(["| T-001 | T-001 | 1 | 0 | 120000 | 0.4200 | 100 | 10 | approved | 0 |", true]);
  });

  // @covers trace:DLT-004
  // @covers trace:BEH-004
  it("records the fixer's lane inference events with no task capability unpriced and without a cost entry", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startTask(tracer, "T-001");
    const fixer = { producerId: "fixer-1", participant: "simple-fixer", taskId: null, loopId: null, isLane: true } as const;

    tracer.recordRuntimeEvent({ ...fixer, type: "inference.started", occurredAt: new Date("2026-10-29T12:03:00.000Z"), model: null, tokenUsage: null });
    tracer.recordRuntimeEvent({ ...fixer, type: "inference.completed", occurredAt: new Date("2026-10-29T12:04:00.000Z"), model: "claude-opus-5-5", tokenUsage: { inputTokens: 500, outputTokens: 120 } });
    tracer.recordBusEvent(delivered(5, "task.approved", "foreman", { taskId: "T-001", implSha: SHA }));
    await tracer.idle();

    const costs: CostsFile = JSON.parse(await readFile(join(dir, "costs.json"), "utf8"));
    const traceTypes = (await readFile(join(dir, "trace.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0).map((line) => typeOf(JSON.parse(line)));
    const traceMd = await readFile(join(dir, "trace.md"), "utf8");
    expect([costs.entries, traceTypes.filter((type) => type.startsWith("inference")), traceMd.includes("warning:")]).toEqual([[], ["inference.started", "inference.completed"], false]);
  });

  // @covers build-stage:DLT-004
  // @covers trace:CTR-002
  it("shows the findingText of an advisory_only review in the task section", async () => {
    const { tracer, dir } = await tracerInTempDir();
    startTask(tracer, "T-001");

    tracer.recordBusEvent(
      delivered(3, "task.reviewed", "foreman", { taskId: "T-001", decision: "advisory_only", target: "none", reportPath: "", specIds: [], findingText: "review unavailable: reviewer produced no handoff after 3 runs" }),
    );
    tracer.recordBusEvent(delivered(4, "task.approved", "foreman", { taskId: "T-001", implSha: SHA }));
    await tracer.idle();

    const traceMd = await readFile(join(dir, "trace.md"), "utf8");
    expect(traceMd).toContain("## Task T-001\n\n- review advisory_only: review unavailable: reviewer produced no handoff after 3 runs\n");
  });
});
