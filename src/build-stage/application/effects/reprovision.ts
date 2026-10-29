import { access } from "node:fs/promises";
import { join } from "node:path";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { argvOf } from "../../domain/command-line.js";
import { taskHandoffDir } from "../../domain/handoff-paths.js";
import type { LaneDeps } from "../lane-deps.js";
import { taskStateOf } from "../lane-inputs.js";
import { runVerifierCommand } from "../verifier-runner.js";
import { runGreenCheck } from "./green-check.js";
import { runImplementer } from "./implementer.js";
import { runRedCheck } from "./red-check.js";
import { linkNodeModules } from "./schedule.js";

export type ReprovisionOrigin = "implementer" | "red-check" | "green-check";

export interface ReprovisionRun {
  readonly taskId: string;
  readonly origin: ReprovisionOrigin;
  readonly attempt: number;
}

export function reprovisionOriginOf(value: unknown): ReprovisionOrigin {
  return value === "red-check" || value === "green-check" ? value : "implementer";
}

async function toolchainWorks(slice: SliceContext, deps: LaneDeps, worktree: string, taskId: string): Promise<boolean> {
  const design = await deps.design.load();
  const outputDir = join(taskHandoffDir(slice.paths.handoffsDir, taskId), "reprovision-probe");
  const timeoutMs = slice.config.timeouts.verifierMs;
  const typecheck = await runVerifierCommand(deps.commands, { argv: argvOf(design.tech.tooling.typecheckCmd), cwd: worktree, outputDir, label: "typecheck", timeoutMs });
  const test = await runVerifierCommand(deps.commands, { argv: [...argvOf(design.tech.tooling.testCmd), "--reporter=json", `--outputFile=${join(outputDir, "vitest.json")}`], cwd: worktree, outputDir, label: "test", timeoutMs });
  return !typecheck.runnerMissing && !test.runnerMissing;
}

async function refreshWorktreeLinks(slice: SliceContext, context: EffectContext): Promise<void> {
  for (const task of Object.values(context.state.tasks)) {
    if (task.worktree.length === 0) {
      continue;
    }
    try {
      await access(task.worktree);
    } catch {
      continue;
    }
    await linkNodeModules(slice.paths.productDir, task.worktree);
  }
}

function rejectClaim(slice: SliceContext, context: EffectContext, taskId: string): void {
  const task = taskStateOf(context.state, taskId);
  if (task.attempts.implementer >= slice.config.caps.implementerAttempts) {
    context.publish({ type: "task.failed", producer: "foreman", payload: { taskId, reason: "cap_exhausted", detail: "implementer" } });
    return;
  }
  context.publish({ type: "task.rework", producer: "foreman", payload: { taskId, target: "implementer", attempt: task.attempts.implementer + 1, reason: "claim_rejected", findingPath: null } });
}

/* build-stage:BEH-011: one `npm ci`, links refreshed, the reporting step re-run at the same attempt. */
export async function runReprovision(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: ReprovisionRun): Promise<void> {
  const task = taskStateOf(context.state, run.taskId);
  if (run.origin === "implementer" && (await toolchainWorks(slice, deps, task.worktree, run.taskId))) {
    rejectClaim(slice, context, run.taskId);
    return;
  }
  const install = await deps.commands.run("npm", ["ci"], { cwd: slice.paths.productDir, timeoutMs: slice.config.timeouts.verifierMs });
  if (install.exitCode !== 0) {
    context.publish({ type: "run.failed", producer: "foreman", payload: { stage: "build", reason: "tooling_broken", detail: `npm ci exited ${install.exitCode}: ${install.stderr.trim().slice(-500)}` } });
    return;
  }
  await refreshWorktreeLinks(slice, context);
  switch (run.origin) {
    case "red-check":
      await runRedCheck(slice, deps, context, { taskId: run.taskId, attempt: run.attempt, firewallViolations: [] });
      return;
    case "green-check":
      await runGreenCheck(slice, deps, context, { taskId: run.taskId, attempt: run.attempt });
      return;
    default:
      await runImplementer(slice, deps, context, { taskId: run.taskId, attempt: run.attempt, reworkFinding: { reason: "toolchain re-provisioned; the previous TOOLING-BROKEN finding was accepted", findingPath: null } });
  }
}
