import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { judgeGreen } from "../../domain/green-verdict.js";
import { roleChangedFiles } from "../../domain/write-set.js";
import type { LaneDeps } from "../lane-deps.js";
import { requireSha, taskStateOf } from "../lane-inputs.js";
import { frozenTestFiles } from "./implementer.js";
import { countersOf, publishToolingBroken, runVerifierCommands, writeEvidence } from "./verifier-shared.js";

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

export async function runGreenCheck(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: GreenCheckRun): Promise<void> {
  const token = deps.lanes.tokenOf(run.taskId);
  const task = taskStateOf(context.state, run.taskId);
  const baseSha = requireSha(task.baseSha, "baseSha");
  const testsSha = requireSha(task.testsSha, "testsSha");
  const design = await deps.design.load();
  const commands = await runVerifierCommands(slice, deps, design.tech.tooling, run.taskId, task.worktree, "green", run.attempt);
  if (!deps.lanes.isLive(token)) {
    return;
  }
  if (commands.typecheck.runnerMissing || commands.test.runnerMissing) {
    publishToolingBroken(context, run.taskId, "green-check", commands);
    return;
  }
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
