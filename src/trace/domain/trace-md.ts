import { RUN_STAGES } from "../../bus/domain/catalogue.js";
import { MID_RUN_COUNT_PREFIX } from "./interventions.js";
import type { FixNote, RunOutcome, TraceReport } from "./report.js";

export const TRACE_MD_SECTIONS = ["## Stages", "## Tasks", "## Totals", "## Assumptions", "## Interventions", "## Warnings"] as const;

export function usdCell(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function outcomeText(outcome: RunOutcome): string {
  switch (outcome.kind) {
    case "published":
      return "published";
    case "failed":
      return `failed:${outcome.stage}/${outcome.reason}`;
    case "in_progress":
      return "in_progress";
  }
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function bulletsOrNone(bullets: readonly string[]): readonly string[] {
  return bullets.length === 0 ? ["none"] : bullets.map((bullet) => `- ${bullet}`);
}

function fixLine(fix: FixNote): string {
  return `- fix ${fix.attempt} ${fix.trigger} -> ${fix.outcome} (${fix.filesChanged} files, ${usdCell(fix.costUsd)})`;
}

function fixCountOf(report: TraceReport, taskId: string): number {
  return report.fixes.filter((fix) => fix.taskId === taskId).length;
}

function section(heading: string, bullets: readonly string[]): readonly string[] {
  return bullets.length === 0 ? [] : [heading, "", ...bullets, ""];
}

/* Trailing sections appear only when they have content, so a run without fixes or advisory reviews ends at Warnings as before. */
function detailSections(report: TraceReport): readonly string[] {
  const taskIds = [...new Set([...report.tasks.map((row) => row.taskId), ...report.fixes.flatMap((fix) => (fix.taskId === null ? [] : [fix.taskId])), ...report.advisories.map((note) => note.taskId)])];
  const taskSections = taskIds.flatMap((taskId) =>
    section(`## Task ${taskId}`, [
      ...report.fixes.filter((fix) => fix.taskId === taskId).map(fixLine),
      ...report.advisories.filter((note) => note.taskId === taskId).map((note) => `- review advisory_only: ${note.findingText}`),
    ]),
  );
  const stageSections = RUN_STAGES.flatMap((stage) => section(`## Stage ${stage}`, report.fixes.filter((fix) => fix.taskId === null && fix.stage === stage).map(fixLine)));
  return [...taskSections, ...stageSections];
}

export function renderTraceMd(report: TraceReport): string {
  const lines = [
    `# Run ${report.runId}`,
    "",
    `- slug: ${report.slug}`,
    `- operator: ${report.operator}`,
    "- mode: autonomous",
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt ?? "in progress"}`,
    `- outcome: ${outcomeText(report.outcome)}`,
    `- cloud: ${report.cloudSessionUrl ?? "none"}`,
    "",
    "## Stages",
    "",
    "| stage | startedAt | endedAt | durationMs | costUsd |",
    "|---|---|---|---|---|",
    ...report.stages.map((row) => `| ${row.stage} | ${row.startedAt} | ${row.endedAt} | ${row.durationMs} | ${usdCell(row.costUsd)} |`),
    "",
    "## Tasks",
    "",
    "| taskId | title | implementer attempts | test-writer attempts | durationMs | costUsd | inputTokens | outputTokens | outcome | fixes |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...report.tasks.map(
      (row) =>
        `| ${row.taskId} | ${cell(row.title)} | ${row.attempts.implementer} | ${row.attempts.testWriter} | ${row.durationMs} | ${usdCell(row.costUsd)} | ${row.inputTokens} | ${row.outputTokens} | ${row.outcome} | ${fixCountOf(report, row.taskId)} |`,
    ),
    "",
    "## Totals",
    "",
    `- durationMs: ${report.totals.durationMs}`,
    `- costUsd: ${usdCell(report.totals.costUsd)}`,
    `- inputTokens: ${report.totals.inputTokens}`,
    `- outputTokens: ${report.totals.outputTokens}`,
    `- unknown-cost entries: ${report.totals.unknownCostEntries}`,
    "",
    "## Assumptions",
    "",
    ...bulletsOrNone(report.assumptions.map((note) => `${note.id}: ${note.text}`)),
    "",
    "## Interventions",
    "",
    `${MID_RUN_COUNT_PREFIX}${report.midRunInterventions} (see [interventions.md](interventions.md))`,
    "",
    "## Warnings",
    "",
    ...bulletsOrNone(report.warnings),
    "",
    ...detailSections(report),
  ];
  return lines.join("\n");
}
