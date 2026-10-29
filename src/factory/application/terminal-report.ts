import type { RunManifest } from "../domain/run-manifest.js";

export interface SuccessSummaryInput {
  readonly manifest: RunManifest;
  readonly tracePath: string;
  readonly totalCostUsd: number;
  readonly durationMs: number;
  readonly midRunInterventions: number;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function successSummary(input: SuccessSummaryInput): string {
  const { manifest } = input;
  return [
    `published: ${manifest.outputDir ?? ""}`,
    `commit: ${manifest.commitSha ?? ""} pushed: ${manifest.pushed === true ? "true" : manifest.pushed === false ? "false (no origin or push rejected)" : "false"}`,
    `trace: ${input.tracePath}`,
    `cost: ${input.totalCostUsd.toFixed(4)} duration: ${formatDuration(input.durationMs)} tasks: ${manifest.counters.tasks}`,
    `mid-run interventions: ${input.midRunInterventions}`,
    "",
  ].join("\n");
}

export interface FailureReportInput {
  readonly stage: string;
  readonly reason: string;
  readonly detail: string;
  readonly runDir: string;
  readonly evidencePath: string;
}

export function failureReport(input: FailureReportInput): string {
  return [`run failed at ${input.stage}: ${input.reason}`, `detail: ${input.detail.split("\n")[0] ?? ""}`, `run dir: ${input.runDir}`, `evidence: ${input.evidencePath}`, ""].join("\n");
}
