import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { parseTechMd, TechMdParseError, UnpinnedDependencyError } from "../../shared/design-files/tech-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { productRelative } from "../domain/firewall.js";
import { designReworkAttempt, effectInteger, effectStrings, pending, publishBlocked, reworkFindingText, specSourceInline, TECH_MD } from "./effect-support.js";
import { ARCHITECT_MESSAGE } from "./messages.js";
import { forbiddenReadsFor, handoffPathOf, runStageRole } from "./stage-role.js";

export async function runArchitectEffect(effect: Effect, context: EffectContext, slice: SliceContext): Promise<void> {
  const attempt = effectInteger(effect, "attempt", 1);
  const specIds = effectStrings(effect, "specIds");
  const reworkFinding = reworkFindingText(effect);
  const source = await specSourceInline(slice);
  const message = slice.prompts.render(ARCHITECT_MESSAGE, {
    slug: slice.slug,
    product_dir: slice.paths.productDir,
    spec_source_path: source.path,
    spec_source_inline: source.inline,
    tech_md: TECH_MD,
    handoff_path: productRelative(slice.paths.productDir, handoffPathOf(slice, "architect")),
    attempt: String(attempt),
    rework_finding: reworkFinding,
  });
  const outcome = await runStageRole(slice, { role: "architect", message, forbiddenReads: forbiddenReadsFor(slice, "architect") });
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
    if (error instanceof UnpinnedDependencyError) {
      context.publish(pending("design.rework", { target: "architect", reason: error.message, attempt: designReworkAttempt(context.state), specIds, usage: outcome.usage, handoffReruns: outcome.reruns }));
      return;
    }
    if (error instanceof TechMdParseError) {
      publishBlocked(context, "tech_md_invalid", error.message, outcome.usage, outcome.reruns);
      return;
    }
    throw error;
  }
  context.publish(pending("design.tech.ready", { path: TECH_MD, specIds, usage: outcome.usage, handoffReruns: outcome.reruns }));
}
