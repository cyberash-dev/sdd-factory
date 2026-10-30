import type { TaskState } from "../../../bus/domain/run-state.js";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { fixScopeOf, runSimpleFix, type SimpleFixRun } from "../../../shared/fixer/index.js";
import type { SliceContext } from "../../../shared/slice.js";
import { isTaskTestFile, judgeRed, type RedVerdict } from "../../domain/red-verdict.js";
import { isUnderTests, roleChangedFiles } from "../../domain/write-set.js";
import { fixerDeps, type LaneDeps } from "../lane-deps.js";
import { requireSha, taskStateOf } from "../lane-inputs.js";
import { countersOf, coversFoundIn, fixCheckOf, hasMechanicalFailure, mechanicalFailureOutput, publishToolingBroken, runVerifierCommands, writeEvidence, type VerifierCommands } from "./verifier-shared.js";

export interface RedCheckRun {
  readonly taskId: string;
  readonly attempt: number;
  readonly firewallViolations: readonly string[];
}

interface RedJudgement {
  readonly verdict: RedVerdict;
  readonly changedFiles: readonly string[];
}

interface RedOutcome {
  readonly commands: VerifierCommands;
  readonly judgement: RedJudgement;
  readonly baseSha: string;
}

async function judgeRun(deps: LaneDeps, task: TaskState, run: RedCheckRun, commands: VerifierCommands): Promise<RedJudgement> {
  const changedFiles = roleChangedFiles(await deps.git.changedFiles(task.worktree));
  const coversFound = await coversFoundIn(
    task.worktree,
    changedFiles.filter((path) => isTaskTestFile(path, task.writes)),
  );
  const verdict = judgeRed({
    timedOut: commands.typecheck.timedOut || commands.test.timedOut,
    typecheckExitCode: commands.typecheck.evidence.exitCode,
    typecheckOutput: `${commands.typecheck.stdout}${commands.typecheck.stderr}`,
    report: commands.report,
    changedFiles,
    writes: task.writes,
    covers: task.covers,
    coversFound,
    firewallViolations: run.firewallViolations,
  });
  return { verdict, changedFiles };
}

/* Only the fixer's surviving edits outside tests/** go into the fix commit; the test-writer's own changes stay subject to rule (e). */
async function commitFixerChanges(deps: LaneDeps, worktree: string, runs: readonly SimpleFixRun[], message: string): Promise<string | null> {
  const kept = new Set(runs.filter((fixRun) => fixRun.outcome !== "discarded").flatMap((fixRun) => fixRun.filesChanged));
  const pending = (await deps.git.changedFiles(worktree)).filter((path) => kept.has(path) && !isUnderTests(path));
  return pending.length === 0 ? null : deps.git.commitPaths(worktree, pending, message);
}

async function fixSuiteError(slice: SliceContext, deps: LaneDeps, context: EffectContext, task: TaskState, run: RedCheckRun, failed: RedOutcome, rerun: () => Promise<VerifierCommands>): Promise<RedOutcome | null> {
  let latest = failed.commands;
  const result = await runSimpleFix(slice, fixerDeps(deps), context, {
    trigger: "red_suite_error",
    owner: "test-writer",
    unit: run.taskId,
    taskId: run.taskId,
    directory: task.worktree,
    scope: fixScopeOf({ trigger: "red_suite_error", writes: task.writes }),
    formatOnly: [],
    failureOutput: mechanicalFailureOutput(failed.commands),
    check: async () => {
      latest = await rerun();
      return fixCheckOf(latest);
    },
  });
  slice.log(`red check ${run.taskId}: simple-fixer ${result.verdict} after ${result.runs.length} run(s)`);
  const lastRun = result.runs.at(-1);
  if (result.verdict !== "fixed" || lastRun === undefined) {
    return null;
  }
  const fixSha = await commitFixerChanges(deps, task.worktree, result.runs, `fix ${run.taskId} red ${lastRun.attempt}`);
  return { commands: latest, judgement: await judgeRun(deps, task, run, latest), baseSha: fixSha ?? failed.baseSha };
}

function isFixableSuiteError(outcome: RedOutcome): boolean {
  return outcome.judgement.verdict.rejection?.reason === "suite_error" && hasMechanicalFailure(outcome.commands);
}

async function concludeRedCheck(slice: SliceContext, deps: LaneDeps, context: EffectContext, task: TaskState, run: RedCheckRun, outcome: RedOutcome): Promise<void> {
  const { verdict, changedFiles } = outcome.judgement;
  const testsSha = verdict.verdict === "pass" ? await deps.git.commitAll(task.worktree, `tests ${run.taskId}`) : null;
  if (verdict.verdict === "pass" && testsSha === null) {
    throw new Error(`red check of ${run.taskId} passed without any change to commit`);
  }
  await writeEvidence(slice, {
    schemaVersion: 1,
    taskId: run.taskId,
    attempt: run.attempt,
    phase: "red",
    worktree: task.worktree,
    baseSha: outcome.baseSha,
    testsSha,
    implSha: null,
    commands: [outcome.commands.typecheck.evidence, outcome.commands.test.evidence],
    vitest: countersOf(outcome.commands.report),
    tests: outcome.commands.report?.tests ?? [],
    covers: verdict.covers,
    changedFiles,
    writeSetOk: verdict.writeSetOk,
    testsUnchanged: null,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
  });
  if (verdict.verdict === "fail") {
    context.publish({ type: "task.tests_rejected", producer: "foreman", payload: { taskId: run.taskId, reason: verdict.rejection.reason, detail: verdict.rejection.detail } });
    return;
  }
  context.publish({ type: "task.tests_red", producer: "foreman", payload: { taskId: run.taskId, testsSha: testsSha ?? "", testFiles: verdict.testFiles } });
}

export async function runRedCheck(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: RedCheckRun): Promise<void> {
  const token = deps.lanes.tokenOf(run.taskId);
  const task = taskStateOf(context.state, run.taskId);
  const design = await deps.design.load();
  const rerun = (): Promise<VerifierCommands> => runVerifierCommands(slice, deps, design.tech.tooling, run.taskId, task.worktree, "red", run.attempt);
  const commands = await rerun();
  if (!deps.lanes.isLive(token)) {
    return;
  }
  if (commands.typecheck.runnerMissing || commands.test.runnerMissing) {
    publishToolingBroken(context, run.taskId, "red-check", commands);
    return;
  }
  const first: RedOutcome = { commands, judgement: await judgeRun(deps, task, run, commands), baseSha: requireSha(task.baseSha, "baseSha") };
  const fixed = isFixableSuiteError(first) ? await fixSuiteError(slice, deps, context, task, run, first, rerun) : null;
  if (!deps.lanes.isLive(token)) {
    return;
  }
  await concludeRedCheck(slice, deps, context, task, run, fixed ?? first);
}
