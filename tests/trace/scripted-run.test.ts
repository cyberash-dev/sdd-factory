import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import { createHarness, failingPath, happyPath } from "./scripted-factory.js";

interface TraceLine {
  readonly seq: number;
  readonly elapsedMs: number;
  readonly type: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly producer: string;
  readonly payload: Record<string, unknown>;
}

function parseLine(line: string): TraceLine {
  const parsed: TraceLine = JSON.parse(line);
  return parsed;
}

async function traceLines(traceDir: string): Promise<TraceLine[]> {
  const text = await readFile(join(traceDir, "trace.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map(parseLine);
}

function laneKey(type: string, payload: Record<string, unknown>): string {
  return `${type}|${String(payload["taskId"] ?? "")}|${String(payload["attempt"] ?? "")}`;
}

describe("trace.jsonl of a scripted run", () => {
  // @covers trace:CTR-001
  it("writes one JSON line per event with the seven keys and contiguous seq, and a mid-run capture is a byte prefix of the final file", async () => {
    const harness = await createHarness();
    let midRunCapture = "";

    await happyPath(harness, {
      afterEvent: async (event) => {
        if (event.type === "design.tasks.ready") {
          midRunCapture = await readFile(join(harness.traceDir, "trace.jsonl"), "utf8");
        }
      },
    });

    const finalText = await readFile(join(harness.traceDir, "trace.jsonl"), "utf8");
    const lines = await traceLines(harness.traceDir);
    expect([
      lines.every((line) => Object.keys(line).sort().join(",") === "elapsedMs,occurredAt,payload,producer,runId,seq,type"),
      lines.map((line) => line.seq),
      finalText.startsWith(midRunCapture) && midRunCapture.length > 0,
      finalText.endsWith("\n"),
    ]).toEqual([true, lines.map((_, index) => index + 1), true, true]);
  });

  // @covers trace:BEH-001
  it("records N bus events plus M runtime events as N+M lines starting with run.started, with non-decreasing elapsedMs", async () => {
    const harness = await createHarness();

    await happyPath(harness);

    const lines = await traceLines(harness.traceDir);
    const busLines = lines.filter((line) => line.producer !== "runtime");
    const runtimeLines = lines.filter((line) => line.producer === "runtime");
    const elapsed = lines.map((line) => line.elapsedMs);
    expect([
      lines[0]?.type,
      busLines.length,
      runtimeLines.length > 0,
      lines.length === busLines.length + runtimeLines.length,
      elapsed.every((value, index) => value >= 0 && (index === 0 || value >= (elapsed[index - 1] ?? 0))),
      runtimeLines.map((line) => line.type).filter((type) => type === "inference.completed").length,
    ]).toEqual(["run.started", harness.published.length, true, true, true, 4]);
  });

  // @covers trace:BEH-001
  it("buffers a runtime event that arrives before run.started and writes it after the run.started line", async () => {
    const harness = await createHarness();

    await happyPath(harness);

    const lines = await traceLines(harness.traceDir);
    const second = lines[1];
    const foremanJoined = lines.find((line) => line.type === "participant.joined" && line.payload["participant"] === "foreman");
    expect([lines[0]?.type, second?.type, second?.seq, second?.elapsedMs, Date.parse(second?.occurredAt ?? "") <= Date.parse(lines[0]?.occurredAt ?? ""), foremanJoined?.seq]).toEqual([
      "run.started",
      "participant.joined",
      2,
      0,
      true,
      3,
    ]);
  });

  // @covers trace:BEH-001
  it("publishes run.failed with reason trace_write_failed when the append fails", async () => {
    const harness = await createHarness({
      prepare: async ({ traceDir }) => {
        await mkdir(join(traceDir, "trace.jsonl"), { recursive: true });
      },
    });

    await harness.publish("run.started", "foreman", { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" });

    expect([harness.engine.state.status, harness.engine.state.failure?.reason]).toEqual(["failed", "trace_write_failed"]);
  });

  // @covers trace:INV-001
  it("contains every published bus event exactly once in publication order", async () => {
    const harness = await createHarness();

    await happyPath(harness);

    const lines = await traceLines(harness.traceDir);
    const recorded = lines.filter((line) => line.producer !== "runtime").map((line) => laneKey(line.type, line.payload));
    const publishedKeys = harness.published.map((event: DeliveredEvent<EventType>) => laneKey(event.type, { ...event.payload }));
    expect(recorded).toEqual(publishedKeys);
  });

  // @covers trace:INV-004
  it("grows trace.jsonl append-only so every capture is a byte prefix of the next", async () => {
    const harness = await createHarness();
    const captures: string[] = [];

    await happyPath(harness, {
      afterEvent: async () => {
        captures.push(await readFile(join(harness.traceDir, "trace.jsonl"), "utf8"));
      },
    });

    const isChain = captures.every((capture, index) => index === 0 || capture.startsWith(captures[index - 1] ?? ""));
    const isGrowing = captures.every((capture, index) => index === 0 || capture.length > (captures[index - 1] ?? "").length);
    expect([captures.length > 20, isChain, isGrowing]).toEqual([true, true, true]);
  });
});

describe("interventions.md of a scripted run", () => {
  // @covers trace:BEH-009
  it("starts with the launch line and ends with mid-run interventions: 0 when nobody intervened", async () => {
    const harness = await createHarness();

    await happyPath(harness);

    const lines = (await readFile(join(harness.traceDir, "interventions.md"), "utf8")).split("\n");
    expect([lines.length, lines[0]?.startsWith("2026-"), lines[0]?.includes(' launch actor=cyberash note="pre-authorized at launch: spec and baseline approvals delegated to the factory"'), lines[1], lines[2]]).toEqual([
      3,
      true,
      true,
      "mid-run interventions: 0",
      "",
    ]);
  });

  // @covers trace:BEH-009
  it("appends each mid-run nudge immediately and counts two nudges as mid-run interventions: 2 in four lines", async () => {
    const harness = await createHarness();
    let afterFirstNudge = "";

    await failingPath(harness);
    const traceDir = harness.traceDir;
    const second = await createHarness();
    await happyPath(second, {
      nudges: [
        { kind: "mid_run_nudge", actor: "cyberash", note: "prefer vitest" },
        { kind: "mid_run_nudge", actor: "cyberash", note: "keep it small" },
      ],
      afterEvent: async (event) => {
        if (event.type === "human.intervention" && afterFirstNudge === "") {
          afterFirstNudge = await readFile(join(second.traceDir, "interventions.md"), "utf8");
        }
      },
    });

    const lines = (await readFile(join(second.traceDir, "interventions.md"), "utf8")).split("\n").filter((line) => line.length > 0);
    expect([afterFirstNudge.split("\n").filter((line) => line.length > 0).length, lines.length, lines[1]?.endsWith(' mid_run_nudge actor=cyberash note="prefer vitest"'), lines[3], (await readFile(join(traceDir, "interventions.md"), "utf8")).endsWith("mid-run interventions: 0\n")]).toEqual([
      2,
      4,
      true,
      "mid-run interventions: 2",
      true,
    ]);
  });

  // @covers trace:BEH-009
  it("logs a fix_between_runs intervention reported at launch without counting it as mid-run", async () => {
    const harness = await createHarness();

    await happyPath(harness, { nudges: [{ kind: "fix_between_runs", actor: "cyberash", note: "edited README by hand" }] });

    const lines = (await readFile(join(harness.traceDir, "interventions.md"), "utf8")).split("\n").filter((line) => line.length > 0);
    expect([lines.length, lines[1]?.includes(' fix_between_runs actor=cyberash note="edited README by hand"'), lines[2]]).toEqual([3, true, "mid-run interventions: 0"]);
  });

  // @covers trace:CTR-003
  it("produces exactly three lines for one nudge whose note contains a double quote, escaped as \\\"", async () => {
    const harness = await createHarness();

    await happyPath(harness, { nudges: [{ kind: "mid_run_nudge", actor: "cyberash", note: 'use "vitest"' }] });

    const lines = (await readFile(join(harness.traceDir, "interventions.md"), "utf8")).split("\n").filter((line) => line.length > 0);
    const lineFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (launch|fix_between_runs|mid_run_nudge) actor=\S+ note="(?:[^"\\]|\\")*"$/;
    expect([lines.length, lines.slice(0, 2).every((line) => lineFormat.test(line)), lines[1]?.endsWith('note="use \\"vitest\\""'), lines[2]]).toEqual([3, true, true, "mid-run interventions: 1"]);
  });
});
