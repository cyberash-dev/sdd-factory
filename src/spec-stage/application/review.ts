import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedHandoff } from "../../bus/domain/handoff.js";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { fileTools } from "../adapters/role-tools.js";
import { derivedDecision, isOpenDecision, parseGaReview, type GaReview, type ReviewDecision } from "../domain/ga-review.js";
import { MAJOR_FINDINGS_PATH, renderMajorFindings } from "../domain/major-findings.js";
import { unappliedFindings } from "./assume-findings.js";
import { effectInteger } from "./effect-fields.js";
import { sha256OrNull } from "./file-digest.js";
import { invokeRole, promptBody, type HandoffVerdict } from "./role-invocation.js";
import { concludeStage, specBlocked, type StageDeps } from "./stage-deps.js";

const CRITIC_MESSAGE = `Review round {{attempt}} of the product spec for "{{slug}}".
Source spec: {{spec_source_path}}
Product directory: {{product_dir}}
Findings file to write: {{product_dir}}/spec/review/ga.md
Handoff to write as your last action: {{handoff_path}}
Relative paths given to read_file, write_file and list_dir resolve against the product directory; absolute paths are accepted.`;

const FINDINGS_PATH = "spec/review/ga.md";

const CRITIC_MAX_OUTPUT_TOKENS = 16000;

export function criticTools(slice: SliceContext, writes: readonly string[]): ReturnType<typeof fileTools> {
  const { productDir, specSourcePath, repoRoot } = slice.paths;
  return fileTools({
    repoRoot,
    productDir,
    reads: [specSourcePath, join(productDir, "spec")],
    writes,
    lists: [productDir, join(productDir, "spec")],
    trace: () => undefined,
  });
}

function decisionOf(handoff: ParsedHandoff): ReviewDecision {
  return handoff.frontmatter["decision"] === "accept" ? "accept" : "rework";
}

interface CriticReview {
  readonly gaText: string;
  readonly review: GaReview;
}

function openFindingIds(review: GaReview, round: number, severity: "major" | "minor"): string {
  return review.findings.filter((finding) => finding.severity === severity && isOpenDecision(finding, round)).map((finding) => finding.id).join(", ");
}

function decisionNote(round: number, decision: ReviewDecision, review: GaReview): string {
  if (decision === review.decision) {
    return `spec-critic round ${round}: decision ${decision}`;
  }
  return decision === "accept" ? `spec-critic round ${round}: decision overridden to accept: only minor findings (${openFindingIds(review, round, "minor")})` : `spec-critic round ${round}: decision overridden to rework: major findings (${openFindingIds(review, round, "major")})`;
}

/* spec-stage:DLT-014: the foreman derives the decision from severities; only major findings reach the analyst. */
async function publishDerivedReview(context: EffectContext, slice: SliceContext, round: number, critic: CriticReview): Promise<void> {
  const { review } = critic;
  const decision = derivedDecision(review.findings, round);
  const producer = decision === review.decision ? "spec-critic" : "foreman";
  slice.log(decisionNote(round, decision, review));
  if (decision === "accept") {
    context.publish({ type: "spec.reviewed", producer, payload: { round, decision, findingsPath: FINDINGS_PATH } });
    return;
  }
  await writeFile(join(slice.paths.productDir, MAJOR_FINDINGS_PATH), renderMajorFindings(critic.gaText, review), "utf8");
  const minorIds = review.findings.filter((finding) => finding.severity === "minor").map((finding) => finding.id);
  if (minorIds.length > 0) {
    slice.log(`spec-critic round ${round}: minor findings kept as advisory: ${minorIds.join(", ")}`);
  }
  context.publish({ type: "spec.reviewed", producer, payload: { round, decision, findingsPath: MAJOR_FINDINGS_PATH } });
}

export async function runReview(effect: Effect, context: EffectContext, slice: SliceContext, deps: StageDeps): Promise<void> {
  const round = effectInteger(effect, "round");
  const { productDir, handoffsDir, specSourcePath, runDir } = slice.paths;
  const handoffPath = join(handoffsDir, "spec-critic", "handoff.md");
  const specPath = join(productDir, "spec", "spec.md");
  const gaPath = join(productDir, FINDINGS_PATH);
  const specBefore = await sha256OrNull(specPath);
  const variables = {
    slug: slice.slug,
    spec_source_path: specSourcePath,
    product_dir: productDir,
    run_dir: runDir,
    handoff_path: handoffPath,
    attempt: String(round),
  };
  const outcome = await invokeRole<CriticReview>(slice, {
    role: "spec-critic",
    instruction: slice.prompts.render(promptBody(await slice.prompts.load("spec-critic")), variables),
    message: slice.prompts.render(CRITIC_MESSAGE, variables),
    model: slice.config.models.critic,
    tools: criticTools(slice, [join(productDir, "spec", "review"), join(productDir, "spec", "assumptions.md"), join(handoffsDir, "spec-critic")]),
    maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS,
    handoffPath,
    async verify(handoff): Promise<HandoffVerdict<CriticReview>> {
      if ((await sha256OrNull(specPath)) !== specBefore) {
        return { kind: "abort", error: `critic_wrote_spec: spec/spec.md changed during review round ${round}` };
      }
      const gaText = await readTextOrNull(gaPath);
      if (gaText === null) {
        return { kind: "retry", error: `${FINDINGS_PATH} was not written` };
      }
      const ga = parseGaReview(gaText);
      if (!ga.ok) {
        return { kind: "retry", error: `${FINDINGS_PATH}: ${ga.error}` };
      }
      const decision = decisionOf(handoff);
      if (ga.review.decision !== decision) {
        return { kind: "retry", error: `${FINDINGS_PATH} says decision ${ga.review.decision} but the handoff says ${decision}` };
      }
      return { kind: "ok", value: { gaText, review: ga.review } };
    },
  });
  if (outcome.kind === "aborted") {
    concludeStage(deps, context, specBlocked("spec-critic", "analyst_blocked", outcome.error));
    return;
  }
  if (outcome.kind === "unparseable") {
    /* spec-stage:DLT-001: the critic never ends the run; an unparseable final round still hands its findings to the foreman. */
    const decision: ReviewDecision = round >= slice.config.caps.criticRounds && (await unappliedFindings(gaPath)).length > 0 ? "rework" : "accept";
    slice.log(`spec-critic round ${round}: handoff unparseable after ${outcome.reruns} re-run(s) (${outcome.error}); the round counts as ${decision}`);
    context.publish({ type: "spec.reviewed", producer: "foreman", payload: { round, decision, findingsPath: FINDINGS_PATH } });
    return;
  }
  await publishDerivedReview(context, slice, round, outcome.value);
}
