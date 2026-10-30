import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { appendAssumptions, nextAssumptionNumber, renderCriticAssumption } from "../domain/assumption-records.js";
import { parseGaReview, type GaFinding } from "../domain/ga-review.js";
import { SPEC_EFFECT_KINDS } from "../effect-kinds.js";
import { runApprove } from "./approve.js";
import { effectInteger, effectString } from "./effect-fields.js";
import { outputTail, type StageDeps } from "./stage-deps.js";
import { lintProductSpecWithFix } from "./spec-lint.js";

const ASSUMPTIONS_PATH = "spec/assumptions.md";

export async function unappliedFindings(gaPath: string): Promise<readonly GaFinding[]> {
  const text = await readTextOrNull(gaPath);
  if (text === null) {
    return [];
  }
  const review = parseGaReview(text);
  return review.ok ? review.review.findings.filter((finding) => finding.resolution === "decide" && finding.applied !== true) : [];
}

/* spec-stage:DLT-001: the final critic round never ends the run; its open findings become sandbox assumptions. */
export async function runAssumeFindings(effect: Effect, context: EffectContext, slice: SliceContext, deps: StageDeps): Promise<void> {
  const round = effectInteger(effect, "round");
  const findingsPath = effectString(effect, "findingsPath");
  const { productDir } = slice.paths;
  const findings = await unappliedFindings(join(productDir, findingsPath));
  const assumptionsPath = join(productDir, ASSUMPTIONS_PATH);
  const existing = await readTextOrNull(assumptionsPath);
  const specText = (await readTextOrNull(join(productDir, "spec", "spec.md"))) ?? "";
  const first = nextAssumptionNumber(slice.slug, [specText, existing ?? ""]);
  const reviewBy = slice.now().toISOString().slice(0, 10);
  const rendered = findings.map((finding, index) => renderCriticAssumption({ slug: slice.slug, number: first + index, finding, round, reviewBy }));
  if (rendered.length > 0) {
    await writeFile(assumptionsPath, appendAssumptions(existing, slice.slug, rendered.map((assumption) => assumption.block)), "utf8");
    const lint = await lintProductSpecWithFix(slice, deps, context);
    if (lint.exitCode !== 0) {
      slice.log(`warning: ${ASSUMPTIONS_PATH} lint exit ${lint.exitCode} after recording critic findings: ${outputTail(lint)}`);
    }
  }
  slice.log(`spec-critic round ${round} answered rework at the cap; ${rendered.length} finding(s) recorded as ${rendered.length === 0 ? "no assumptions" : rendered.map((assumption) => assumption.id).join(", ")}`);
  /* A second spec.reviewed for the same round would be a duplicate for bus:BEH-002, so approval follows directly. */
  await runApprove({ kind: SPEC_EFFECT_KINDS.approve }, context, slice, deps);
}
