import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { isTaskTestFile, judgeRed } from "../../domain/red-verdict.js";
import { roleChangedFiles } from "../../domain/write-set.js";
import type { LaneDeps } from "../lane-deps.js";
import { requireSha, taskStateOf } from "../lane-inputs.js";
import { countersOf, coversFoundIn, publishToolingBroken, runVerifierCommands, writeEvidence } from "./verifier-shared.js";

export interface RedCheckRun {
  readonly taskId: string;
  readonly attempt: number;
  readonly firewallViolations: readonly string[];
}

export async function runRedCheck(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: RedCheckRun): Promise<void> {
  const token = deps.lanes.tokenOf(run.taskId);
  const task = taskStateOf(context.state, run.taskId);
  const design = await deps.design.load();
  const commands = await runVerifierCommands(slice, deps, design.tech.tooling, run.taskId, task.worktree, "red", run.attempt);
  if (!deps.lanes.isLive(token)) {
    return;
  }
  if (commands.typecheck.runnerMissing || commands.test.runnerMissing) {
    publishToolingBroken(context, run.taskId, "red-check", commands);
    return;
  }
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
    baseSha: requireSha(task.baseSha, "baseSha"),
    testsSha,
    implSha: null,
    commands: [commands.typecheck.evidence, commands.test.evidence],
    vitest: countersOf(commands.report),
    tests: commands.report?.tests ?? [],
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
