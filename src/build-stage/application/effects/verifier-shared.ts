import { readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { FixCheck } from "../../../shared/fixer/index.js";
import type { TechTooling } from "../../../shared/design-files/tech-md.js";
import { readTextOrNull, writeTextAtomic } from "../../../shared/fs/text.js";
import type { SliceContext } from "../../../shared/slice.js";
import { argvOf } from "../../domain/command-line.js";
import { coversMarkersIn } from "../../domain/covers-markers.js";
import { taskHandoffDir } from "../../domain/handoff-paths.js";
import { EMPTY_COUNTERS, evidenceFileName, type VerifierEvidence, type VerifierPhase } from "../../domain/verifier-evidence.js";
import { parseVitestReport, type VitestSummary } from "../../domain/vitest-report.js";
import type { LaneDeps } from "../lane-deps.js";
import { runVerifierCommand, type VerifierCommandRun } from "../verifier-runner.js";

export interface VerifierCommands {
  readonly typecheck: VerifierCommandRun;
  readonly test: VerifierCommandRun;
  readonly report: VitestSummary | null;
  readonly outputDir: string;
}

export const VITEST_REPORT_FLAGS = ["--reporter=json"] as const;

export async function runVerifierCommands(slice: SliceContext, deps: LaneDeps, tooling: TechTooling, taskId: string, worktree: string, phase: VerifierPhase, attempt: number): Promise<VerifierCommands> {
  const outputDir = join(taskHandoffDir(slice.paths.handoffsDir, taskId), `verifier-${phase}-${attempt}`);
  const timeoutMs = slice.config.timeouts.verifierMs;
  const typecheck = await runVerifierCommand(deps.commands, { argv: argvOf(tooling.typecheckCmd), cwd: worktree, outputDir, label: "typecheck", timeoutMs });
  const reportPath = join(outputDir, "vitest.json");
  await rm(reportPath, { force: true });
  const test = await runVerifierCommand(deps.commands, { argv: [...argvOf(tooling.testCmd), ...VITEST_REPORT_FLAGS, `--outputFile=${reportPath}`], cwd: worktree, outputDir, label: "test", timeoutMs });
  const reportText = await readTextOrNull(reportPath);
  return { typecheck, test, report: reportText === null ? null : parseVitestReport(reportText, await realpath(worktree)), outputDir };
}

export function countersOf(report: VitestSummary | null): VerifierEvidence["vitest"] {
  return report === null ? EMPTY_COUNTERS : { total: report.total, passed: report.passed, failed: report.failed, skipped: report.skipped, suitesFailedToLoad: report.suitesFailedToLoad };
}

export async function coversFoundIn(worktree: string, files: readonly string[]): Promise<readonly string[]> {
  const found = new Set<string>();
  for (const file of files) {
    for (const id of coversMarkersIn(await readFile(join(worktree, file), "utf8"))) {
      found.add(id);
    }
  }
  return [...found];
}

export async function writeEvidence(slice: SliceContext, evidence: VerifierEvidence): Promise<string> {
  const path = join(taskHandoffDir(slice.paths.handoffsDir, evidence.taskId), evidenceFileName(evidence.phase, evidence.attempt));
  await writeTextAtomic(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return path;
}

export function publishToolingBroken(context: EffectContext, taskId: string, origin: string, commands: VerifierCommands): void {
  const broken = commands.typecheck.runnerMissing ? commands.typecheck : commands.test;
  context.publish({ type: "task.finding", producer: "foreman", payload: { taskId, type: "TOOLING-BROKEN", specIds: [], detail: `${broken.evidence.argv.join(" ")}: ${broken.stderr.trim().slice(-500)}`, origin } });
}

function isTimedOut(commands: VerifierCommands): boolean {
  return commands.typecheck.timedOut || commands.test.timedOut;
}

/* factory:BEH-012 lane triggers: a typecheck exit not 0 or a suite that fails to load; timeouts and assertion failures are not the fixer's. */
export function hasMechanicalFailure(commands: VerifierCommands): boolean {
  return !isTimedOut(commands) && (commands.typecheck.evidence.exitCode !== 0 || (commands.report?.suitesFailedToLoad ?? 0) > 0);
}

export function mechanicalFailureOutput(commands: VerifierCommands): string {
  const loadFailures = (commands.report?.tests ?? []).filter((test) => test.failureKind === "load").map((test) => `${test.file}: ${test.message}`);
  return [`${commands.typecheck.stdout}${commands.typecheck.stderr}`.trim(), ...loadFailures].filter((part) => part.length > 0).join("\n\n");
}

export function fixCheckOf(commands: VerifierCommands): FixCheck {
  const passed = commands.report !== null && !isTimedOut(commands) && commands.typecheck.evidence.exitCode === 0 && commands.report.suitesFailedToLoad === 0;
  return { passed, output: mechanicalFailureOutput(commands) };
}
