import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../../shared/fs/text.js";
import { isTerminatedOutcome, type CliRoleOutcome } from "../../../shared/llm/cli-role-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { laneHandoffPath, laneTranscriptPath } from "../../domain/handoff-paths.js";
import { implementerMessage, instructionVariables } from "../../domain/lane-messages.js";
import type { ReworkFinding } from "../../domain/rules/support.js";
import { isUnderTests } from "../../domain/write-set.js";
import { costFieldsOf, runCliLane, withLaneParticipant } from "../cli-lane.js";
import { runWithHandoffRetry, type ParseOutcome } from "../handoff-roundtrip.js";
import type { LaneDeps } from "../lane-deps.js";
import { laneInputs, requireSha, reworkFindingText } from "../lane-inputs.js";
import { laneMessageInput, parseLaneHandoff } from "./test-writer.js";

export interface ImplementerRun {
  readonly taskId: string;
  readonly attempt: number;
  readonly reworkFinding: ReworkFinding | null;
}

interface ImplementerHandoff {
  readonly status: string;
  readonly finding: { readonly type: string; readonly specIds: readonly string[]; readonly detail: string } | null;
  readonly blockedReason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function implementerHandoffOf(frontmatter: Readonly<Record<string, unknown>>): ParseOutcome<ImplementerHandoff> {
  const status = String(frontmatter["status"]);
  if (status !== "finding") {
    return { ok: true, value: { status, finding: null, blockedReason: String(frontmatter["blocked_reason"] ?? "") } };
  }
  const finding = frontmatter["finding"];
  if (!isRecord(finding) || typeof finding["type"] !== "string" || typeof finding["detail"] !== "string") {
    return { ok: false, error: "missing_required_key:finding.detail" };
  }
  const specIds = Array.isArray(finding["spec_ids"]) ? finding["spec_ids"].filter((item): item is string => typeof item === "string") : null;
  if (specIds === null) {
    return { ok: false, error: "missing_required_key:finding.spec_ids" };
  }
  return { ok: true, value: { status, finding: { type: finding["type"], specIds, detail: finding["detail"] }, blockedReason: "" } };
}

export async function frozenTestFiles(deps: LaneDeps, worktree: string, baseSha: string, testsSha: string): Promise<readonly string[]> {
  return (await deps.git.diffNames(worktree, baseSha, testsSha)).filter(isUnderTests);
}

export async function runImplementer(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: ImplementerRun): Promise<void> {
  const token = deps.lanes.tokenOf(run.taskId);
  const inputs = await laneInputs(slice, deps, context.state, run.taskId);
  const handoffPath = laneHandoffPath(slice.paths.handoffsDir, run.taskId, "implementer", run.attempt);
  const transcriptPath = laneTranscriptPath(slice.paths.handoffsDir, run.taskId, "implementer", run.attempt);
  const base = laneMessageInput(slice, inputs, handoffPath, run.attempt, await reworkFindingText(run.reworkFinding, inputs.task.worktree));
  const frozen = await frozenTestFiles(deps, inputs.task.worktree, requireSha(inputs.task.baseSha, "baseSha"), requireSha(inputs.task.testsSha, "testsSha"));
  const instruction = slice.prompts.render(await slice.prompts.load("implementer"), instructionVariables(base));
  let lastRun: CliRoleOutcome | null = null;
  await withLaneParticipant(slice, "implementer", run.taskId, async (lane) => {
    const result = await runWithHandoffRetry(
      {
        role: "implementer",
        handoffPath,
        maxReruns: slice.config.caps.handoffRerun,
        invoke: async (message) => {
          lastRun = await runCliLane(slice, deps, { worktree: inputs.task.worktree, handoffPath, instruction, message, transcriptPath }, lane);
          return lastRun;
        },
        isTerminated: isTerminatedOutcome,
        parse: async () => {
          const parsed = parseLaneHandoff("implementer", lastRun, await readTextOrNull(handoffPath));
          return parsed.ok ? implementerHandoffOf(parsed.value.frontmatter) : parsed;
        },
      },
      implementerMessage({ ...base, frozenTestFiles: frozen }),
    );
    if (!deps.lanes.isLive(token)) {
      slice.log(`implementer result dropped for cancelled lane ${run.taskId}`);
      return;
    }
    if (!result.ok && result.terminated === true) {
      slice.log(`implementer ${run.taskId} ended by a termination signal; nothing published`);
      return;
    }
    if (!result.ok) {
      context.publish({ type: "task.failed", producer: "foreman", payload: { taskId: run.taskId, reason: "unparseable_handoff", detail: `implementer: ${result.error}` } });
      return;
    }
    const handoff = result.parsed;
    if (handoff.finding !== null) {
      context.publish({ type: "task.finding", producer: "implementer", payload: { taskId: run.taskId, type: handoff.finding.type, specIds: handoff.finding.specIds, detail: handoff.finding.detail, origin: "implementer" } });
      return;
    }
    if (handoff.status === "blocked") {
      context.publish({ type: "task.failed", producer: "implementer", payload: { taskId: run.taskId, reason: "blocked", detail: `implementer: ${handoff.blockedReason}` } });
      return;
    }
    context.publish({ type: "task.impl_done", producer: "implementer", payload: { taskId: run.taskId, attempt: run.attempt, handoffPath, ...costFieldsOf(result.run) } });
  });
}
