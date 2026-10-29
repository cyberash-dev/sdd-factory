import type { TraceReport } from "./report.js";

export const COSTS_SCHEMA_VERSION = 1;

export function renderCostsJson(report: TraceReport): string {
  const pricing = Object.fromEntries(
    Object.entries(report.pricing).map(([model, price]) => [model, { inputPerMTok: price.inputPerMillion, outputPerMTok: price.outputPerMillion }]),
  );
  const document = {
    schemaVersion: COSTS_SCHEMA_VERSION,
    runId: report.runId,
    pricing,
    stages: report.stages,
    tasks: report.tasks,
    participants: report.participants,
    entries: report.entries,
    totals: report.totals,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
