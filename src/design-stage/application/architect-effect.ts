import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { parseTechMd, techMdBlockData, TechMdParseError, UnpinnedDependencyError } from "../../shared/design-files/tech-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SimpleFixDeps } from "../../shared/fixer/index.js";
import type { SliceContext } from "../../shared/slice.js";
import { createDesignFileFixer, UNWIRED_FIX_DEPS } from "./design-file-fix.js";
import { designReworkAttempt, effectInteger, effectStrings, pending, publishBlocked, reworkFindingText, TECH_MD } from "./effect-support.js";
import { ARCHITECT_MESSAGE } from "./messages.js";
import { handoffPathOf, runStageRole } from "./stage-role.js";

function techMdError(text: string): TechMdParseError | null {
  try {
    parseTechMd(text);
    return null;
  } catch (error) {
    if (error instanceof TechMdParseError) {
      return error;
    }
    throw error;
  }
}

/* An unpinned dependency is the architect's decision, not a format slip, so it skips the simple-fixer. */
function unparseableMessage(text: string): string | null {
  const error = techMdError(text);
  return error === null || error instanceof UnpinnedDependencyError ? null : error.message;
}

/* design-stage:DLT-005: an unparseable tech.md goes to the simple-fixer first; the file is parsed again after it. */
async function techMdErrorAfterFix(slice: SliceContext, fix: SimpleFixDeps, context: EffectContext, text: string): Promise<TechMdParseError | null> {
  const message = unparseableMessage(text);
  if (message === null) {
    return techMdError(text);
  }
  await createDesignFileFixer(slice, fix, context).repair({ owner: "architect", file: TECH_MD, failureOutput: message, blocks: techMdBlockData, parseError: unparseableMessage });
  const repaired = await readTextOrNull(join(slice.paths.productDir, TECH_MD));
  return repaired === null ? new TechMdParseError(`${TECH_MD} was deleted`) : techMdError(repaired);
}

export async function runArchitectEffect(effect: Effect, context: EffectContext, slice: SliceContext, fix: SimpleFixDeps = UNWIRED_FIX_DEPS): Promise<void> {
  const attempt = effectInteger(effect, "attempt", 1);
  const specIds = effectStrings(effect, "specIds");
  const reworkFinding = reworkFindingText(effect);
  const message = slice.prompts.render(ARCHITECT_MESSAGE, {
    slug: slice.slug,
    product_dir: slice.paths.productDir,
    spec_source_path: slice.paths.specSourcePath,
    tech_md: TECH_MD,
    handoff_path: handoffPathOf(slice, "architect"),
    attempt: String(attempt),
    rework_finding: reworkFinding,
  });
  const outcome = await runStageRole(slice, { role: "architect", message, mode: context.state.status === "building" ? "repair" : "first_pass" });
  if (outcome.kind === "blocked") {
    publishBlocked(context, outcome.reason, outcome.detail, outcome.usage, outcome.reruns);
    return;
  }
  const text = await readTextOrNull(join(slice.paths.productDir, TECH_MD));
  if (text === null) {
    publishBlocked(context, "tech_md_invalid", `${TECH_MD} was not written`, outcome.usage, outcome.reruns);
    return;
  }
  const error = await techMdErrorAfterFix(slice, fix, context, text);
  if (error !== null) {
    /* design-stage:DLT-001: a file the parser rejects goes back to the architect once; a repair attempt's unusable file blocks. */
    if (attempt > 1) {
      publishBlocked(context, "tech_md_invalid", error.message, outcome.usage, outcome.reruns);
      return;
    }
    context.publish(pending("design.rework", { target: "architect", reason: error.message, attempt: designReworkAttempt(context.state), originTaskId: null, specIds, usage: outcome.usage, handoffReruns: outcome.reruns }));
    return;
  }
  context.publish(pending("design.tech.ready", { path: TECH_MD, specIds, usage: outcome.usage, handoffReruns: outcome.reruns }));
}
