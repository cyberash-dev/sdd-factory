import { join } from "node:path";
import type { ParsedHandoff } from "../../bus/domain/handoff.js";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { fileTools } from "../adapters/role-tools.js";
import { parseGaReview, type ReviewDecision } from "../domain/ga-review.js";
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
  const outcome = await invokeRole<ReviewDecision>(slice, {
    role: "spec-critic",
    instruction: slice.prompts.render(promptBody(await slice.prompts.load("spec-critic")), variables),
    message: slice.prompts.render(CRITIC_MESSAGE, variables),
    model: slice.config.models.critic,
    tools: criticTools(slice, [join(productDir, "spec", "review"), join(productDir, "spec", "assumptions.md"), join(handoffsDir, "spec-critic")]),
    maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS,
    handoffPath,
    async verify(handoff): Promise<HandoffVerdict<ReviewDecision>> {
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
      return { kind: "ok", value: decision };
    },
  });
  if (outcome.kind === "aborted") {
    concludeStage(deps, context, specBlocked("spec-critic", "analyst_blocked", outcome.error));
    return;
  }
  if (outcome.kind === "unparseable") {
    concludeStage(deps, context, specBlocked("spec-critic", "analyst_blocked", `unparseable_handoff: ${outcome.error}`));
    return;
  }
  slice.log(`spec-critic round ${round}: decision ${outcome.value}`);
  context.publish({ type: "spec.reviewed", producer: "spec-critic", payload: { round, decision: outcome.value, findingsPath: FINDINGS_PATH } });
}
