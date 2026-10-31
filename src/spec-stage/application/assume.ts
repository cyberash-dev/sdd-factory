import { join } from "node:path";
import type { ParsedHandoff } from "../../bus/domain/handoff.js";
import type { PendingEvent, Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { isStringArray } from "../domain/guards.js";
import { parseSpecRecords } from "../domain/spec-records.js";
import { effectString, effectStrings } from "./effect-fields.js";
import { sha256OrNull } from "./file-digest.js";
import { criticTools } from "./review.js";
import { invokeRole, promptBody, type HandoffVerdict } from "./role-invocation.js";
import { outputTail, type StageDeps } from "./stage-deps.js";
import { lintProductSpecWithFix } from "./spec-lint.js";

const ASSUME_MESSAGE = `Assumption mode for product "{{slug}}", task {{task_id}}. This is not a review round: write no spec/review/ga.md.
A lane finding needs a decision on approved records that can no longer change: {{spec_ids}}.
Finding:
{{finding}}

Read {{product_dir}}/spec/spec.md for those records and the source spec {{spec_source_path}}. Choose one reading and append exactly one ASSUMPTION record to {{product_dir}}/spec/assumptions.md under the heading "## 18. Assumptions" (when the file does not exist, create it with the 19 headings and the literal none in every other section). The record: id {{slug}}:ASM-NNN continuing the numbering used so far, lifecycle {status: proposed}, partition_id {{slug}}, assumption stated as a fact about observable behaviour, source_open_q null, blocking no, review_by {{review_by}}, default_if_unresolved keep_assumption, tests naming the lane tests of {{task_id}}, notes citing the finding and the task id.
Never write spec/spec.md or any file other than spec/assumptions.md and the handoff.
Then write {{handoff_path}} with role spec-critic, attempt {{attempt}}, status complete, decision accept, findings [] and assumptions_added holding the new id.`;

const ASSUMPTIONS_PATH = "spec/assumptions.md";

const ASSUME_MAX_OUTPUT_TOKENS = 8000;

async function assumptionCount(path: string): Promise<number> {
  const text = await readTextOrNull(path);
  return text === null ? 0 : parseSpecRecords(text).filter((record) => record.type === "ASSUMPTION").length;
}

function taskFailed(taskId: string, reason: "cap_exhausted" | "unparseable_handoff" | "blocked", detail: string): PendingEvent {
  return { type: "task.failed", producer: "foreman", payload: { taskId, reason, detail } };
}

/* build-stage:DLT-014: a review-mode route runs only after task.verified{green}, so a failed assumption step approves on that evidence. */
function assumptionStepFailed(context: EffectContext, slice: SliceContext, taskId: string, reason: "unparseable_handoff" | "blocked", detail: string): void {
  const task = context.state.tasks[taskId];
  const hasGreenEvidence = task !== undefined && task.status === "review_pending" && task.implSha !== null;
  if (!hasGreenEvidence) {
    context.publish(taskFailed(taskId, reason, detail));
    return;
  }
  slice.log(`${taskId} approved on green evidence: contract route minted no assumption, review findings kept as advisory`);
  context.publish({
    type: "task.reviewed",
    producer: "foreman",
    payload: { taskId, decision: "advisory_only", target: "none", reportPath: "", specIds: [], findingText: `contract route minted no assumption: ${detail}` },
  });
}

function firstOf(values: readonly string[], label: string): string {
  const first = values[0];
  if (first === undefined) {
    throw new Error(`spec.assume needs at least one ${label}`);
  }
  return first;
}

export async function runAssume(effect: Effect, context: EffectContext, slice: SliceContext, deps: StageDeps): Promise<void> {
  const specIds = effectStrings(effect, "specIds");
  const taskIds = effectStrings(effect, "taskIds");
  const finding = effectString(effect, "finding");
  const firstTask = firstOf(taskIds, "taskId");
  const originTask = Object.hasOwn(effect, "taskId") ? effectString(effect, "taskId") : firstTask;
  firstOf(specIds, "specId");
  const requestCounts = specIds.map((id) => context.state.assumptionsByRecord[id] ?? 0);
  if (requestCounts.some((count) => count > slice.config.caps.criticAssumptionsPerId)) {
    context.publish(taskFailed(firstTask, "cap_exhausted", "critic assumption cap"));
    return;
  }
  const attempt = Math.max(1, ...requestCounts);
  const { productDir, handoffsDir, specSourcePath, runDir } = slice.paths;
  const handoffPath = join(handoffsDir, "tasks", firstTask, `spec-critic-${attempt}`, "handoff.md");
  const specPath = join(productDir, "spec", "spec.md");
  const assumptionsPath = join(productDir, ASSUMPTIONS_PATH);
  const specBefore = await sha256OrNull(specPath);
  const assumptionsBefore = await assumptionCount(assumptionsPath);
  const variables = {
    slug: slice.slug,
    spec_source_path: specSourcePath,
    product_dir: productDir,
    run_dir: runDir,
    handoff_path: handoffPath,
    attempt: String(attempt),
    task_id: firstTask,
    spec_ids: specIds.join(", "),
    finding,
    review_by: slice.now().toISOString().slice(0, 10),
  };
  const outcome = await invokeRole<string>(slice, {
    role: "spec-critic",
    instruction: slice.prompts.render(promptBody(await slice.prompts.load("spec-critic")), variables),
    message: slice.prompts.render(ASSUME_MESSAGE, variables),
    model: slice.config.models.critic,
    tools: criticTools(slice, [assumptionsPath, join(handoffsDir, "tasks", firstTask)]),
    maxOutputTokens: ASSUME_MAX_OUTPUT_TOKENS,
    handoffPath,
    async verify(handoff: ParsedHandoff): Promise<HandoffVerdict<string>> {
      if ((await sha256OrNull(specPath)) !== specBefore) {
        return { kind: "abort", error: "critic_wrote_spec: spec/spec.md changed in assumption mode" };
      }
      const added = (await assumptionCount(assumptionsPath)) - assumptionsBefore;
      if (added !== 1) {
        return { kind: "retry", error: `${ASSUMPTIONS_PATH} must gain exactly one ASSUMPTION record, it gained ${added}` };
      }
      const assumptionsAdded = handoff.frontmatter["assumptions_added"];
      const assumptionId = isStringArray(assumptionsAdded) ? assumptionsAdded[0] : undefined;
      return typeof assumptionId === "string" ? { kind: "ok", value: assumptionId } : { kind: "retry", error: "assumptions_added must list the new ASSUMPTION id" };
    },
  });
  if (outcome.kind === "aborted") {
    assumptionStepFailed(context, slice, originTask, "blocked", outcome.error);
    return;
  }
  if (outcome.kind === "unparseable") {
    assumptionStepFailed(context, slice, originTask, "unparseable_handoff", outcome.error);
    return;
  }
  const lint = await lintProductSpecWithFix(slice, deps, context);
  if (lint.exitCode !== 0) {
    context.publish(taskFailed(firstTask, "blocked", `assumptions_file_invalid: ${outputTail(lint)}`));
    return;
  }
  slice.log(`spec-critic assumption ${outcome.value} decided ${specIds.join(", ")} for ${taskIds.join(", ")}`);
  for (const taskId of taskIds) {
    const testWriterAttempts = context.state.tasks[taskId]?.attempts.testWriter ?? 0;
    context.publish({
      type: "task.rework",
      producer: "foreman",
      payload: { taskId, target: "test-writer", attempt: testWriterAttempts + 1, reason: `assumption ${outcome.value} decided ${specIds.join(", ")}`, findingPath: ASSUMPTIONS_PATH },
    });
  }
}
