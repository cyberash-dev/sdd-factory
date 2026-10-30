import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { TaskState } from "../../../bus/domain/run-state.js";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { fixScopeOf, runSimpleFix, type GreenTrigger, type SimpleFixResult } from "../../../shared/fixer/index.js";
import type { SliceContext } from "../../../shared/slice.js";
import { judgeGreen } from "../../domain/green-verdict.js";
import { roleChangedFiles } from "../../domain/write-set.js";
import { fixerDeps, type LaneDeps } from "../lane-deps.js";
import { requireSha, taskStateOf } from "../lane-inputs.js";
import { frozenTestFiles } from "./implementer.js";
import { countersOf, fixCheckOf, hasMechanicalFailure, mechanicalFailureOutput, publishToolingBroken, runVerifierCommands, writeEvidence, type VerifierCommands } from "./verifier-shared.js";

export interface GreenCheckRun {
  readonly taskId: string;
  readonly attempt: number;
}

async function revertPaths(deps: LaneDeps, worktree: string, ref: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const restored = await deps.git.tryRun(worktree, ["checkout", "-q", ref, "--", path]);
    if (restored.exitCode !== 0) {
      await rm(join(worktree, path), { force: true, recursive: true });
    }
  }
}

function greenTriggerOf(commands: VerifierCommands): GreenTrigger | null {
  if (!hasMechanicalFailure(commands)) {
    return null;
  }
  if (commands.typecheck.evidence.exitCode !== 0) {
    return "green_typecheck";
  }
  return commands.report !== null && commands.report.failed === 0 ? "green_load_failure" : null;
}

async function fixMechanicalFailure(slice: SliceContext, deps: LaneDeps, context: EffectContext, task: TaskState, run: GreenCheckRun, failed: VerifierCommands, trigger: GreenTrigger): Promise<SimpleFixResult> {
  const result = await runSimpleFix(slice, fixerDeps(deps), context, {
    trigger,
    owner: "implementer",
    unit: run.taskId,
    taskId: run.taskId,
    directory: task.worktree,
    scope: fixScopeOf({ trigger, writes: task.writes }),
    formatOnly: [],
    failureOutput: mechanicalFailureOutput(failed),
    check: async () => fixCheckOf(await runVerifierCommands(slice, deps, (await deps.design.load()).tech.tooling, run.taskId, task.worktree, "green", run.attempt)),
  });
  slice.log(`green check ${run.taskId}: simple-fixer ${trigger} ${result.verdict} after ${result.runs.length} run(s)`);
  return result;
}

async function concludeGreenCheck(slice: SliceContext, deps: LaneDeps, context: EffectContext, task: TaskState, run: GreenCheckRun, commands: VerifierCommands): Promise<void> {
  const baseSha = requireSha(task.baseSha, "baseSha");
  const testsSha = requireSha(task.testsSha, "testsSha");
  const testFiles = await frozenTestFiles(deps, task.worktree, baseSha, testsSha);
  const testsUnchanged = await deps.git.isUnchanged(task.worktree, testsSha, testFiles);
  const changedFiles = roleChangedFiles(await deps.git.changedFiles(task.worktree));
  const verdict = judgeGreen({ timedOut: commands.typecheck.timedOut || commands.test.timedOut, typecheckExitCode: commands.typecheck.evidence.exitCode, report: commands.report, changedFiles, writes: task.writes, testsUnchanged });
  let implSha: string | null = null;
  if (verdict.verdict === "pass") {
    implSha = (await deps.git.commitAll(task.worktree, `impl ${run.taskId} attempt ${run.attempt}`)) ?? (await deps.git.revParse(task.worktree, "HEAD"));
  } else {
    await revertPaths(deps, task.worktree, testsSha, [...new Set([...(testsUnchanged ? [] : testFiles), ...verdict.offendingFiles])]);
  }
  const evidencePath = await writeEvidence(slice, {
    schemaVersion: 1,
    taskId: run.taskId,
    attempt: run.attempt,
    phase: "green",
    worktree: task.worktree,
    baseSha,
    testsSha,
    implSha,
    commands: [commands.typecheck.evidence, commands.test.evidence],
    vitest: countersOf(commands.report),
    tests: commands.report?.tests ?? [],
    covers: { required: task.covers, found: task.covers, missing: [], unknown: [] },
    changedFiles,
    writeSetOk: verdict.writeSetOk,
    testsUnchanged,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
  });
  context.publish({
    type: "task.verified",
    producer: "foreman",
    payload: { taskId: run.taskId, result: verdict.verdict === "pass" ? "green" : "red", evidencePath, testsUnchanged, writeSetOk: verdict.writeSetOk, implSha },
  });
}

/* After a fixed run the check re-runs once without the fixer: context.state does not yet count the runs just made, so a nested fixer could exceed caps.simpleFixes. */
async function greenCheck(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: GreenCheckRun, isFixerAllowed: boolean): Promise<void> {
  const token = deps.lanes.tokenOf(run.taskId);
  const task = taskStateOf(context.state, run.taskId);
  const design = await deps.design.load();
  const commands = await runVerifierCommands(slice, deps, design.tech.tooling, run.taskId, task.worktree, "green", run.attempt);
  if (!deps.lanes.isLive(token)) {
    return;
  }
  if (commands.typecheck.runnerMissing || commands.test.runnerMissing) {
    publishToolingBroken(context, run.taskId, "green-check", commands);
    return;
  }
  const trigger = isFixerAllowed ? greenTriggerOf(commands) : null;
  if (trigger !== null) {
    const fix = await fixMechanicalFailure(slice, deps, context, task, run, commands, trigger);
    if (!deps.lanes.isLive(token)) {
      return;
    }
    if (fix.verdict === "fixed") {
      await greenCheck(slice, deps, context, run, false);
      return;
    }
  }
  await concludeGreenCheck(slice, deps, context, task, run, commands);
}

export async function runGreenCheck(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: GreenCheckRun): Promise<void> {
  await greenCheck(slice, deps, context, run, true);
}
