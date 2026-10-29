import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { specIntegrityProblems } from "../domain/spec-records.js";
import type { CommandResult } from "../ports/command-runner.js";
import { concludeStage, outputTail, specBlocked, type StageDeps } from "./stage-deps.js";

const APPROVAL_MODE = "pre-authorized-at-launch";

function approveArgv(slice: SliceContext, id: string): readonly string[] {
  return ["approve", "--id", id, "--approver", slice.operator, "--owner-role", "product-owner", "--change-request", `${slice.runId}: pre-authorised at launch`, "--scope", "first-time-approval", "--format=json"];
}

function finalizedCount(result: CommandResult): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("finalized_ids" in parsed) || !Array.isArray(parsed.finalized_ids)) {
    return null;
  }
  return parsed.finalized_ids.length;
}

export async function runApprove(_effect: Effect, context: EffectContext, slice: SliceContext, deps: StageDeps): Promise<void> {
  const productDir = slice.paths.productDir;
  const blocked = (detail: string): void => concludeStage(deps, context, specBlocked("foreman", "analyst_blocked", detail));
  const lintBefore = await deps.commands.run(["lint", "--format=json"], productDir);
  if (lintBefore.exitCode !== 0) {
    blocked(`lint_failed: ${outputTail(lintBefore)}`);
    return;
  }
  const problems = specIntegrityProblems((await readTextOrNull(join(productDir, "spec", "spec.md"))) ?? "");
  if (problems.length > 0) {
    blocked(`spec_integrity: ${problems.join("; ")}`);
    return;
  }
  const approveAll = await deps.commands.run(approveArgv(slice, `${slice.slug}:*`), productDir);
  if (approveAll.exitCode !== 0) {
    blocked(`approve_failed: ${outputTail(approveAll)}`);
    return;
  }
  const approveBaseline = await deps.commands.run(approveArgv(slice, `${slice.slug}:BL-001`), productDir);
  if (approveBaseline.exitCode !== 0 && !approveBaseline.stdout.includes("no-id-match")) {
    blocked(`approve_failed: ${outputTail(approveBaseline)}`);
    return;
  }
  const finalize = await deps.commands.run(["finalize", "--format=json"], productDir);
  const approvedIds = finalize.exitCode === 0 ? finalizedCount(finalize) : null;
  if (approvedIds === null) {
    blocked(`finalize_failed: ${outputTail(finalize)}`);
    return;
  }
  const lintAfter = await deps.commands.run(["lint", "--format=json"], productDir);
  if (lintAfter.exitCode !== 0) {
    blocked(`lint_failed_after_finalize: ${outputTail(lintAfter)}`);
    return;
  }
  slice.log(`spec approved: ${approvedIds} records flipped by ${slice.operator}`);
  concludeStage(deps, context, { type: "spec.approved", producer: "foreman", payload: { approver: slice.operator, mode: APPROVAL_MODE, approvedIds } });
}
