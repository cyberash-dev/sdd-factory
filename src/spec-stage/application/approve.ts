import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import { parseFinalizeEnvelope } from "../../shared/sdd/envelope.js";
import type { SliceContext } from "../../shared/slice.js";
import { specIntegrityProblems } from "../domain/spec-records.js";
import { concludeStage, outputTail, specBlocked, type StageDeps } from "./stage-deps.js";

const APPROVAL_MODE = "pre-authorized-at-launch";

function approveArgv(slice: SliceContext, id: string): readonly string[] {
  return ["approve", "--id", id, "--approver", slice.operator, "--owner-role", "product-owner", "--change-request", `${slice.runId}: pre-authorised at launch`, "--scope", "first-time-approval", "--format=json"];
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
  if (finalize.exitCode !== 0) {
    blocked(`finalize_failed: ${outputTail(finalize)}`);
    return;
  }
  const finalized = parseFinalizeEnvelope(finalize.stdout);
  if (!finalized.ok) {
    blocked(`finalize_failed: ${finalized.kind ?? outputTail(finalize)}`);
    return;
  }
  const approvedIds = finalized.flipped.length;
  const lintAfter = await deps.commands.run(["lint", "--format=json"], productDir);
  if (lintAfter.exitCode !== 0) {
    blocked(`lint_failed_after_finalize: ${outputTail(lintAfter)}`);
    return;
  }
  slice.log(`spec approved: ${approvedIds} records flipped by ${slice.operator}`);
  concludeStage(deps, context, { type: "spec.approved", producer: "foreman", payload: { approver: slice.operator, mode: APPROVAL_MODE, approvedIds } });
}
