import { describe, expect, it } from "vitest";
import type { TraceReport } from "./report.js";
import { renderTraceMd } from "./trace-md.js";

function fixtureReport(overrides: Partial<TraceReport> = {}): TraceReport {
  return {
    runId: "todo-cli-20261029-120000",
    slug: "todo-cli",
    operator: "cyberash",
    startedAt: "2026-10-29T12:00:00.000Z",
    finishedAt: "2026-10-29T12:12:00.000Z",
    outcome: { kind: "published" },
    pricing: {},
    stages: [{ stage: "build", startedAt: "2026-10-29T12:07:00.000Z", endedAt: "2026-10-29T12:10:00.000Z", durationMs: 180000, costUsd: 0.4521, inputTokens: 1200, outputTokens: 300 }],
    tasks: [
      { taskId: "T-001", title: "Domain model", attempts: { implementer: 2, testWriter: 1 }, durationMs: 390000, costUsd: 0.4321, inputTokens: 1000, outputTokens: 250, models: ["m"], outcome: "approved" },
      { taskId: "T-002", title: "CLI entry", attempts: { implementer: 1, testWriter: 1 }, durationMs: 60000, costUsd: 0.02, inputTokens: 200, outputTokens: 50, models: [], outcome: "approved" },
    ],
    participants: [],
    entries: [],
    totals: { durationMs: 720000, costUsd: 0.4521, inputTokens: 1200, outputTokens: 300, unknownCostEntries: 0 },
    fixes: [],
    advisories: [],
    assumptions: [{ id: "todo-cli:ASM-001", text: "Tasks are stored in a JSON file." }],
    midRunInterventions: 1,
    warnings: [],
    cloudSessionUrl: null,
    chain: null,
    ...overrides,
  };
}

const SECTION_ORDER = ["# Run todo-cli-20261029-120000", "- slug: todo-cli", "## Stages", "## Tasks", "## Totals", "## Assumptions", "## Interventions", "## Warnings"];

function sectionOffsets(text: string): number[] {
  return SECTION_ORDER.map((section) => text.indexOf(`${section}\n`));
}

describe("trace.md rendering", () => {
  // @covers trace:CTR-002
  it("renders the eight sections in order with one task row per task and a Totals costUsd equal to the literal sum", () => {
    const text = renderTraceMd(fixtureReport());

    const offsets = sectionOffsets(text);
    expect([
      offsets.every((offset, index) => offset >= 0 && (index === 0 || offset > (offsets[index - 1] ?? 0))),
      text.includes("| T-001 | Domain model | 2 | 1 | 390000 | 0.4321 | 1000 | 250 | approved | 0 |\n| T-002 | CLI entry | 1 | 1 | 60000 | 0.0200 | 200 | 50 | approved | 0 |"),
      text.includes("| stage | startedAt | endedAt | durationMs | costUsd |\n|---|---|---|---|---|\n| build | 2026-10-29T12:07:00.000Z | 2026-10-29T12:10:00.000Z | 180000 | 0.4521 |"),
      text.includes("- durationMs: 720000\n- costUsd: 0.4521\n- inputTokens: 1200\n- outputTokens: 300\n- unknown-cost entries: 0"),
      text.includes("- todo-cli:ASM-001: Tasks are stored in a JSON file."),
      text.includes("mid-run interventions: 1 (see [interventions.md](interventions.md))"),
      text.includes("- outcome: published\n"),
      text.endsWith("## Warnings\n\nnone\n"),
    ]).toEqual([true, true, true, true, true, true, true, true]);
  });

  // @covers trace:DLT-002
  it("ends the header with the cloud session link, or none when the run was not mirrored", () => {
    const mirrored = renderTraceMd(fixtureReport({ cloudSessionUrl: "https://app.jigjoy.ai/?s=sess-1" }));
    const offline = renderTraceMd(fixtureReport());

    expect([mirrored.includes("- outcome: published\n- cloud: https://app.jigjoy.ai/?s=sess-1\n"), offline.includes("- outcome: published\n- cloud: none\n")]).toEqual([true, true]);
  });

  // @covers trace:CTR-002
  it("prints n/a for null costs of a task and of a stage", () => {
    const text = renderTraceMd(
      fixtureReport({
        stages: [{ stage: "build", startedAt: "2026-10-29T12:07:00.000Z", endedAt: "2026-10-29T12:10:00.000Z", durationMs: 180000, costUsd: null, inputTokens: 1200, outputTokens: 300 }],
        tasks: [{ taskId: "T-001", title: "Domain model", attempts: { implementer: 1, testWriter: 1 }, durationMs: 390000, costUsd: null, inputTokens: 1000, outputTokens: 250, models: [], outcome: "approved" }],
        totals: { durationMs: 720000, costUsd: 0, inputTokens: 1200, outputTokens: 300, unknownCostEntries: 2 },
      }),
    );

    expect([text.includes("| T-001 | Domain model | 1 | 1 | 390000 | n/a | 1000 | 250 | approved | 0 |"), text.includes("| 180000 | n/a |"), text.includes("- costUsd: 0.0000"), text.includes("- unknown-cost entries: 2")]).toEqual([true, true, true, true]);
  });

  // @covers trace:CTR-002
  it("states a failed run as failed:<stage>/<reason> and an unfinished run as in progress", () => {
    const failed = renderTraceMd(fixtureReport({ outcome: { kind: "failed", stage: "build", reason: "cap_exhausted" } }));
    const inProgress = renderTraceMd(fixtureReport({ outcome: { kind: "in_progress" }, finishedAt: null }));

    expect([failed.includes("- outcome: failed:build/cap_exhausted\n"), inProgress.includes("- finishedAt: in progress\n- outcome: in_progress\n")]).toEqual([true, true]);
  });

  // @covers trace:CTR-002
  it("lists each warning as a bullet and prints none for an empty assumptions list", () => {
    const text = renderTraceMd(fixtureReport({ warnings: ["warning: no price for model m", "warning: no token usage for model m"], assumptions: [] }));

    expect([text.includes("## Warnings\n\n- warning: no price for model m\n- warning: no token usage for model m\n"), text.includes("## Assumptions\n\nnone\n")]).toEqual([true, true]);
  });

  it("escapes a pipe inside a task title so the table keeps its columns", () => {
    const text = renderTraceMd(fixtureReport({ tasks: [{ taskId: "T-001", title: "a | b", attempts: { implementer: 1, testWriter: 1 }, durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, models: [], outcome: "approved" }] }));

    expect(text).toContain("| T-001 | a \\| b | 1 |");
  });
});
