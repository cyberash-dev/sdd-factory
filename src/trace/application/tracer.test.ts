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
    expect(row).toBe("| T-001 | T-001 | 1 | 1 | 180000 | n/a | 200 | 20 | approved |");
  });
});
