import { describe, expect, it } from "vitest";
import { createRunManifest } from "../domain/run-manifest.js";
import { failureReport, successSummary } from "./terminal-report.js";

describe("terminal report", () => {
  // @covers factory:CTR-002
  it("prints the five success lines with their prefixes", () => {
    const manifest = { ...createRunManifest({ runId: "todo-cli-20261029-120000", slug: "todo-cli", specPath: "s.md", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" }), status: "published" as const, commitSha: "ab".repeat(20), outputDir: "hidden/todo-cli/", pushed: true, counters: { tasks: 3, tasksApproved: 3, tasksFailed: 0, reworks: 1 } };

    const text = successSummary({ manifest, tracePath: ".factory/runs/x/trace/trace.md", totalCostUsd: 1.23456, durationMs: 3725000, midRunInterventions: 0 });

    expect(text.split("\n")).toEqual(["published: hidden/todo-cli/", `commit: ${"ab".repeat(20)} pushed: true`, "trace: .factory/runs/x/trace/trace.md", "cost: 1.2346 duration: 1:02:05 tasks: 3", "mid-run interventions: 0", ""]);
  });

  it("states pushed false with the no-origin note", () => {
    const manifest = { ...createRunManifest({ runId: "r", slug: "s", specPath: "s.md", operator: "o", startedAt: "2026-10-29T12:00:00.000Z" }), pushed: false };

    const line = successSummary({ manifest, tracePath: "t", totalCostUsd: 0, durationMs: 0, midRunInterventions: 0 }).split("\n")[1];

    expect(line).toBe("commit:  pushed: false (no origin or push rejected)");
  });

  it("prints the four failure lines with only the first line of the detail", () => {
    const text = failureReport({ stage: "build", reason: "cap_exhausted", detail: "T-001 implementer attempts\nstack trace line", runDir: ".factory/runs/x", evidencePath: ".factory/runs/x/state.json" });

    expect(text.split("\n")).toEqual(["run failed at build: cap_exhausted", "detail: T-001 implementer attempts", "run dir: .factory/runs/x", "evidence: .factory/runs/x/state.json", ""]);
  });
});
