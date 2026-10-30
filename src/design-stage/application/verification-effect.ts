import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { filePathReferences, missingVerificationBlocks, parseVerificationMd, VerificationMdParseError } from "../../shared/design-files/verification-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import type { RoleUsage } from "../domain/payloads.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { effectInteger, pending, publishBlocked, VERIFICATION_MD } from "./effect-support.js";
import { approvedRecordIds, VERIFICATION_BLOCK_TYPES } from "./eligible-ids.js";
import { VERIFICATION_DESIGNER_MESSAGE } from "./messages.js";
import { addUsage, handoffPathOf, runStageRole, zeroUsage, type StageRoleOutcome } from "./stage-role.js";

type Problems = { readonly kind: "blocked"; readonly reason: string; readonly detail: string } | { readonly kind: "rework"; readonly reason: string; readonly detail: string } | { readonly kind: "ok" };

async function inspectVerificationMd(slice: SliceContext, commands: CommandRunner): Promise<Problems> {
  const text = await readTextOrNull(join(slice.paths.productDir, VERIFICATION_MD));
  if (text === null) {
    return { kind: "blocked", reason: "verification_md_invalid", detail: `${VERIFICATION_MD} was not written` };
  }
  let design;
  try {
    design = parseVerificationMd(text);
  } catch (error) {
    if (error instanceof VerificationMdParseError) {
      /* design-stage:DLT-001: the parser message goes back to the designer once; a second unusable file blocks. */
      return { kind: "rework", reason: "verification_md_invalid", detail: error.message };
    }
    throw error;
  }
  const required = await approvedRecordIds(commands, slice.paths.productDir, slice.config.timeouts.verifierMs, VERIFICATION_BLOCK_TYPES);
  const findings = missingVerificationBlocks(design, required).map((id) => `missing_block: ${id}`);
  for (const block of design.blocks) {
    const references = filePathReferences(block);
    if (references.length > 0) {
      findings.push(`block_references_file_path: ${block.id} (${references.join(", ")})`);
    }
  }
  return findings.length === 0 ? { kind: "ok" } : { kind: "rework", reason: "verification_incomplete", detail: findings.join("; ") };
}

async function invoke(slice: SliceContext, attempt: number, reworkFinding: string): Promise<StageRoleOutcome> {
  const message = slice.prompts.render(VERIFICATION_DESIGNER_MESSAGE, {
    slug: slice.slug,
    product_dir: slice.paths.productDir,
    verification_md: VERIFICATION_MD,
    handoff_path: handoffPathOf(slice, "verification-designer"),
    attempt: String(attempt),
    rework_finding: reworkFinding,
  });
  return runStageRole(slice, { role: "verification-designer", message });
}

/* design-stage:CTR-002 and DLT-001: a missing block, a file-path reference or a file the parser rejects re-runs the designer once inside this effect, then blocks. */
export async function runVerificationEffect(effect: Effect, context: EffectContext, slice: SliceContext, commands: CommandRunner): Promise<void> {
  let attempt = effectInteger(effect, "attempt", 1);
  let reworkFinding = "";
  let usage: RoleUsage = zeroUsage(slice.config.models.default);
  let reruns = 0;
  for (let round = 0; round < 2; round += 1) {
    const outcome = await invoke(slice, attempt, reworkFinding);
    usage = addUsage(usage, outcome.usage);
    reruns += outcome.reruns;
    if (outcome.kind === "blocked") {
      publishBlocked(context, outcome.reason, outcome.detail, usage, reruns);
      return;
    }
    const problems = await inspectVerificationMd(slice, commands);
    if (problems.kind === "ok") {
      context.publish(pending("design.verification.ready", { path: VERIFICATION_MD, usage, handoffReruns: reruns }));
      return;
    }
    if (problems.kind === "blocked" || round === 1) {
      publishBlocked(context, problems.reason, problems.detail, usage, reruns);
      return;
    }
    slice.log(`design-stage: verification-designer rework: ${problems.detail}`);
    attempt += 1;
    reworkFinding = problems.detail;
  }
}
