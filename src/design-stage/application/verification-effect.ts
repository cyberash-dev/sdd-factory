import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { filePathReferences, missingVerificationBlocks, parseVerificationMd, verificationBlockData, VerificationMdParseError, type VerificationDesign } from "../../shared/design-files/verification-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SimpleFixDeps } from "../../shared/fixer/index.js";
import type { SliceContext } from "../../shared/slice.js";
import type { RoleUsage } from "../domain/payloads.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { createDesignFileFixer, UNWIRED_FIX_DEPS, type DesignFileFixer } from "./design-file-fix.js";
import { effectInteger, pending, publishBlocked, VERIFICATION_MD } from "./effect-support.js";
import { approvedRecordIds, VERIFICATION_BLOCK_TYPES } from "./eligible-ids.js";
import { VERIFICATION_DESIGNER_MESSAGE } from "./messages.js";
import { addUsage, handoffPathOf, runStageRole, zeroUsage, type StageRoleOutcome } from "./stage-role.js";

type Problems = { readonly kind: "blocked"; readonly reason: string; readonly detail: string } | { readonly kind: "rework"; readonly reason: string; readonly detail: string } | { readonly kind: "ok" };

type ParsedFile = { readonly kind: "missing" } | { readonly kind: "unparseable"; readonly message: string } | { readonly kind: "parsed"; readonly design: VerificationDesign };

function parseVerificationText(text: string): ParsedFile {
  try {
    return { kind: "parsed", design: parseVerificationMd(text) };
  } catch (error) {
    if (error instanceof VerificationMdParseError) {
      return { kind: "unparseable", message: error.message };
    }
    throw error;
  }
}

function parseErrorOf(text: string): string | null {
  const parsed = parseVerificationText(text);
  return parsed.kind === "unparseable" ? parsed.message : null;
}

async function readVerificationMd(slice: SliceContext): Promise<ParsedFile> {
  const text = await readTextOrNull(join(slice.paths.productDir, VERIFICATION_MD));
  return text === null ? { kind: "missing" } : parseVerificationText(text);
}

/* design-stage:DLT-005: an unparseable file goes to the simple-fixer first and is read again after it. */
async function readRepaired(slice: SliceContext, fixer: DesignFileFixer): Promise<ParsedFile> {
  const parsed = await readVerificationMd(slice);
  if (parsed.kind !== "unparseable") {
    return parsed;
  }
  await fixer.repair({ owner: "verification-designer", file: VERIFICATION_MD, failureOutput: parsed.message, blocks: verificationBlockData, parseError: parseErrorOf });
  return readVerificationMd(slice);
}

async function inspectVerificationMd(slice: SliceContext, commands: CommandRunner, fixer: DesignFileFixer): Promise<Problems> {
  const parsed = await readRepaired(slice, fixer);
  if (parsed.kind === "missing") {
    return { kind: "blocked", reason: "verification_md_invalid", detail: `${VERIFICATION_MD} was not written` };
  }
  if (parsed.kind === "unparseable") {
    /* design-stage:DLT-001: the parser message goes back to the designer once; a second unusable file blocks. */
    return { kind: "rework", reason: "verification_md_invalid", detail: parsed.message };
  }
  const design = parsed.design;
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

/* design-stage:CTR-002, DLT-001 and DLT-005: a missing block, a file-path reference or a file the parser rejects re-runs the designer once inside this effect, then blocks. */
export async function runVerificationEffect(effect: Effect, context: EffectContext, slice: SliceContext, commands: CommandRunner, fix: SimpleFixDeps = UNWIRED_FIX_DEPS): Promise<void> {
  let attempt = effectInteger(effect, "attempt", 1);
  let reworkFinding = "";
  let usage: RoleUsage = zeroUsage(slice.config.models.default);
  let reruns = 0;
  const fixer = createDesignFileFixer(slice, fix, context);
  for (let round = 0; round < 2; round += 1) {
    const outcome = await invoke(slice, attempt, reworkFinding);
    usage = addUsage(usage, outcome.usage);
    reruns += outcome.reruns;
    if (outcome.kind === "blocked") {
      publishBlocked(context, outcome.reason, outcome.detail, usage, reruns);
      return;
    }
    const problems = await inspectVerificationMd(slice, commands, fixer);
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
