import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { parseTechMd, TechMdParseError, UnpinnedDependencyError } from "../../shared/design-files/tech-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { designReworkAttempt, effectInteger, effectStrings, pending, publishBlocked, reworkFindingText, TECH_MD } from "./effect-support.js";
import { ARCHITECT_MESSAGE } from "./messages.js";
import { handoffPathOf, runStageRole } from "./stage-role.js";

export async function runArchitectEffect(effect: Effect, context: EffectContext, slice: SliceContext): Promise<void> {
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
  const outcome = await runStageRole(slice, { role: "architect", message });
  if (outcome.kind === "blocked") {
    publishBlocked(context, outcome.reason, outcome.detail, outcome.usage, outcome.reruns);
    return;
  }
  const text = await readTextOrNull(join(slice.paths.productDir, TECH_MD));
  if (text === null) {
    publishBlocked(context, "tech_md_invalid", `${TECH_MD} was not written`, outcome.usage, outcome.reruns);
    return;
  }
  try {
    parseTechMd(text);
  } catch (error) {
    if (!(error instanceof UnpinnedDependencyError || error instanceof TechMdParseError)) {
      throw error;
    }
    /* design-stage:DLT-001: a file the parser rejects goes back to the architect once; a repair attempt's unusable file blocks. */
    if (error instanceof TechMdParseError && attempt > 1) {
      publishBlocked(context, "tech_md_invalid", error.message, outcome.usage, outcome.reruns);
      return;
    }
    context.publish(pending("design.rework", { target: "architect", reason: error.message, attempt: designReworkAttempt(context.state), specIds, usage: outcome.usage, handoffReruns: outcome.reruns }));
    return;
  }
  context.publish(pending("design.tech.ready", { path: TECH_MD, specIds, usage: outcome.usage, handoffReruns: outcome.reruns }));
}
