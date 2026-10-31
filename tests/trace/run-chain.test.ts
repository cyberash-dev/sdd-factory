import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload, Producer } from "../../src/bus/domain/envelope.js";
import { earlierRunReader } from "../../src/trace/adapters/outbound/run-chain.js";
import { TraceFiles } from "../../src/trace/adapters/outbound/trace-files.js";
import { Tracer } from "../../src/trace/application/tracer.js";
import { createRedactor } from "../../src/trace/domain/redaction.js";

interface Manifest {
  readonly runId: string;
  readonly status: "running" | "published" | "failed";
  readonly stage: string;
  readonly reason: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly resumedFrom: string | null;
}

interface RunTotals {
  readonly durationMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface OwnRun {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

async function writeManifest(runsRoot: string, manifest: Manifest): Promise<void> {
  const document = {
    schemaVersion: 1,
    runId: manifest.runId,
    slug: "room-booking-api",
    specPath: "/repo/specs/room-booking-api.md",
    operator: "cyberash",
    mode: "autonomous",
    status: manifest.status,
    stage: manifest.stage,
    startedAt: manifest.startedAt,
    endedAt: manifest.endedAt,
    reason: manifest.reason,
    commitSha: null,
    outputDir: null,
    pushed: null,
    counters: { tasks: 6, tasksApproved: 5, tasksFailed: 1, reworks: 4 },
    resumedFrom: manifest.resumedFrom,
  };
  await mkdir(join(runsRoot, manifest.runId), { recursive: true });
  await writeFile(join(runsRoot, manifest.runId, "run.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function writeEarlierRun(runsRoot: string, manifest: Manifest, totals: RunTotals): Promise<void> {
  await writeManifest(runsRoot, manifest);
  const costs = { schemaVersion: 1, runId: manifest.runId, pricing: {}, stages: [], tasks: [], participants: [], entries: [], totals: { ...totals, unknownCostEntries: 0 } };
  await mkdir(join(runsRoot, manifest.runId, "trace"), { recursive: true });
  await writeFile(join(runsRoot, manifest.runId, "trace", "costs.json"), `${JSON.stringify(costs, null, 2)}\n`, "utf8");
}

function delivered(runId: string, seq: number, type: EventType, producer: Producer, payload: EventPayload, occurredAt: string): DeliveredEvent<EventType> {
  return { type, runId, occurredAt, producer, payload, seq };
}

async function publishedTraceMd(runsRoot: string, runId: string, own: OwnRun): Promise<string> {
  const runDir = join(runsRoot, runId);
  const tracer = new Tracer({
    runId,
    slug: "room-booking-api",
    operator: "cyberash",
    pricing: {},
    store: new TraceFiles(join(runDir, "trace"), createRedactor([])),
    readProductText: () => null,
    readEarlierRuns: earlierRunReader(runDir),
    now: () => new Date(own.finishedAt),
    publish: () => undefined,
    log: () => undefined,
  });
  tracer.recordBusEvent(delivered(runId, 1, "run.started", "foreman", { specPath: "spec.md", slug: "room-booking-api", operator: "cyberash", mode: "autonomous" }, own.startedAt));
  tracer.recordBusEvent(
    delivered(runId, 2, "task.impl_done", "implementer", { taskId: "T-001", attempt: 1, handoffPath: "h.md", costUsd: own.costUsd, inputTokens: own.inputTokens, outputTokens: own.outputTokens, durationMs: 1000 }, own.startedAt),
  );
  tracer.recordBusEvent(delivered(runId, 3, "run.published", "assembler", { commitSha: "29b1edda42542fccd8ad546d772a9e4aa65fc9f7", outputDir: "hidden/room-booking-api/", pushed: false }, own.finishedAt));
  await tracer.idle();
  return readFile(join(runDir, "trace", "trace.md"), "utf8");
}

async function resumedRunTraceMd(): Promise<string> {
  const runsRoot = await mkdtemp(join(tmpdir(), "trace-chain-"));
  await writeEarlierRun(
    runsRoot,
    { runId: "room-booking-api-20261031-021626", status: "failed", stage: "build", reason: "cap_exhausted", startedAt: "2026-10-31T02:16:26.406Z", endedAt: "2026-10-31T02:59:56.334Z", resumedFrom: null },
    { durationMs: 2609901, costUsd: 3.272092, inputTokens: 4533402, outputTokens: 568579 },
  );
  await writeManifest(runsRoot, { runId: "room-booking-api-20261031-030005", status: "running", stage: "build", reason: null, startedAt: "2026-10-31T03:00:05.204Z", endedAt: null, resumedFrom: "room-booking-api-20261031-021626" });
  return publishedTraceMd(runsRoot, "room-booking-api-20261031-030005", { startedAt: "2026-10-31T03:00:05.204Z", finishedAt: "2026-10-31T03:09:23.421Z", costUsd: 0.4809, inputTokens: 777568, outputTokens: 44791 });
}

async function unavailableRunTraceMd(runsRoot: string): Promise<string> {
  await writeManifest(runsRoot, { runId: "room-booking-api-20261031-021626", status: "failed", stage: "build", reason: "cap_exhausted", startedAt: "2026-10-31T02:16:26.406Z", endedAt: "2026-10-31T02:59:56.334Z", resumedFrom: null });
  await writeManifest(runsRoot, { runId: "room-booking-api-20261031-030005", status: "running", stage: "build", reason: null, startedAt: "2026-10-31T03:00:05.204Z", endedAt: null, resumedFrom: "room-booking-api-20261031-021626" });
  return publishedTraceMd(runsRoot, "room-booking-api-20261031-030005", { startedAt: "2026-10-31T03:00:05.204Z", finishedAt: "2026-10-31T03:09:23.421Z", costUsd: 0.4809, inputTokens: 777568, outputTokens: 44791 });
}

describe("trace.md of a resumed run whose earlier run cannot be read", () => {
  // @covers trace:DLT-005
  it("shows the earlier run without costs.json as unavailable, with no time or cost", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "trace-chain-"));

    const text = await unavailableRunTraceMd(runsRoot);

    expect(text).toContain(
      [
        "| room-booking-api-20261031-021626 | unavailable | n/a | n/a | n/a | n/a | n/a |",
        "| room-booking-api-20261031-030005 | published | 2026-10-31T03:00:05.204Z | 2026-10-31T03:09:23.421Z | 558217 | 0.4809 | this report |",
      ].join("\n"),
    );
  });

  // @covers trace:DLT-005
  it("leaves the unavailable run out of the chain totals and counts it", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "trace-chain-"));

    const text = await unavailableRunTraceMd(runsRoot);

    expect(text).toContain("- chain durationMs: 558217\n- chain costUsd: 0.4809\n- chain inputTokens: 777568\n- chain outputTokens: 44791\n- chain unavailable runs: 1\n");
  });

  // @covers trace:DLT-005
  it("lists the unavailable run with the path it could not read under Warnings", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "trace-chain-"));

    const text = await unavailableRunTraceMd(runsRoot);

    expect(text).toContain(`## Warnings\n\n- warning: earlier run room-booking-api-20261031-021626 unavailable: ${join(runsRoot, "room-booking-api-20261031-021626", "trace", "costs.json")} is missing\n`);
  });
});

describe("trace.md of a resumed run", () => {
  // @covers trace:DLT-005
  // @covers trace:CTR-002
  it("lists the first run with its failure, time and cost and the resumed run with its own in the Chain section", async () => {
    const text = await resumedRunTraceMd();

    expect(text).toContain(
      [
        "## Chain",
        "",
        "| runId | outcome | startedAt | finishedAt | durationMs | costUsd | report |",
        "|---|---|---|---|---|---|---|",
        "| room-booking-api-20261031-021626 | failed:build/cap_exhausted | 2026-10-31T02:16:26.406Z | 2026-10-31T02:59:56.334Z | 2609901 | 3.2721 | [trace.md](chain/room-booking-api-20261031-021626/trace.md) |",
        "| room-booking-api-20261031-030005 | published | 2026-10-31T03:00:05.204Z | 2026-10-31T03:09:23.421Z | 558217 | 0.4809 | this report |",
      ].join("\n"),
    );
  });

  // @covers trace:DLT-005
  // @covers trace:CTR-002
  it("sums the durations, costs and tokens of every run of the chain under the Chain table", async () => {
    const text = await resumedRunTraceMd();

    expect(text).toContain("- chain durationMs: 3168118\n- chain costUsd: 3.7530\n- chain inputTokens: 5310970\n- chain outputTokens: 613370\n");
  });

  // @covers trace:DLT-005
  it("lists every run of a three-run chain from the first to the current one, linking the earlier reports", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "trace-chain-"));
    await writeEarlierRun(
      runsRoot,
      { runId: "room-booking-api-20261031-010000", status: "failed", stage: "build", reason: "cap_exhausted", startedAt: "2026-10-31T01:00:00.000Z", endedAt: "2026-10-31T01:30:00.000Z", resumedFrom: null },
      { durationMs: 1800000, costUsd: 1.5, inputTokens: 1000, outputTokens: 100 },
    );
    await writeEarlierRun(
      runsRoot,
      { runId: "room-booking-api-20261031-020000", status: "failed", stage: "assembly", reason: "runtime_error", startedAt: "2026-10-31T02:00:00.000Z", endedAt: "2026-10-31T02:20:00.000Z", resumedFrom: "room-booking-api-20261031-010000" },
      { durationMs: 1200000, costUsd: 0.75, inputTokens: 500, outputTokens: 50 },
    );
    await writeManifest(runsRoot, { runId: "room-booking-api-20261031-030000", status: "running", stage: "assembly", reason: null, startedAt: "2026-10-31T03:00:00.000Z", endedAt: null, resumedFrom: "room-booking-api-20261031-020000" });

    const text = await publishedTraceMd(runsRoot, "room-booking-api-20261031-030000", { startedAt: "2026-10-31T03:00:00.000Z", finishedAt: "2026-10-31T03:10:00.000Z", costUsd: 0.25, inputTokens: 200, outputTokens: 20 });

    expect(text).toContain(
      [
        "| room-booking-api-20261031-010000 | failed:build/cap_exhausted | 2026-10-31T01:00:00.000Z | 2026-10-31T01:30:00.000Z | 1800000 | 1.5000 | [trace.md](chain/room-booking-api-20261031-010000/trace.md) |",
        "| room-booking-api-20261031-020000 | failed:assembly/runtime_error | 2026-10-31T02:00:00.000Z | 2026-10-31T02:20:00.000Z | 1200000 | 0.7500 | [trace.md](chain/room-booking-api-20261031-020000/trace.md) |",
        "| room-booking-api-20261031-030000 | published | 2026-10-31T03:00:00.000Z | 2026-10-31T03:10:00.000Z | 600000 | 0.2500 | this report |",
      ].join("\n"),
    );
  });

  // @covers trace:DLT-005
  // @covers trace:CTR-002
  it("writes no Chain section for a run that is not a resume", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "trace-chain-"));
    await writeManifest(runsRoot, { runId: "room-booking-api-20261031-021626", status: "running", stage: "build", reason: null, startedAt: "2026-10-31T02:16:26.406Z", endedAt: null, resumedFrom: null });

    const text = await publishedTraceMd(runsRoot, "room-booking-api-20261031-021626", { startedAt: "2026-10-31T02:16:26.406Z", finishedAt: "2026-10-31T02:59:56.334Z", costUsd: 3.272092, inputTokens: 4533402, outputTokens: 568579 });

    expect([text.includes("## Chain"), text.endsWith("## Warnings\n\nnone\n")]).toEqual([false, true]);
  });
});
