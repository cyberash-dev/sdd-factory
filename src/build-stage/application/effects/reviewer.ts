import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describeHandoffError, parseHandoff } from "../../../bus/domain/handoff.js";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../../shared/fs/text.js";
import type { ApiRoleUsage } from "../../../shared/llm/api-role-runner.js";
import { listDirTool, readFileTool } from "../../../shared/llm/tools.js";
import type { SliceContext } from "../../../shared/slice.js";
import { laneHandoffPath, reviewReportPath, taskHandoffDir } from "../../domain/handoff-paths.js";
import { instructionVariables, reviewerMessage, type ArbitrationFinding } from "../../domain/lane-messages.js";
import { blockingFindingText, blockingSpecIds, parseReviewReport, type ReviewMode, type ReviewReport } from "../../domain/review-report.js";
import { evidenceFileName } from "../../domain/verifier-evidence.js";
import { runWithHandoffRetry, type ParseOutcome } from "../handoff-roundtrip.js";
import type { LaneDeps } from "../lane-deps.js";
import { laneInputs, requireSha } from "../lane-inputs.js";
import { restrictedWriteFileTool } from "../reviewer-tools.js";
import { frozenTestFiles } from "./implementer.js";
import { laneMessageInput } from "./test-writer.js";

export interface ReviewerRun {
  readonly taskId: string;
  readonly mode: ReviewMode;
  readonly attempt: number;
  readonly finding: ArbitrationFinding | null;
}

export const REVIEWER_MAX_OUTPUT_TOKENS = 16_384;
export const WORKTREE_HANDOFF_DIR = ".handoff";
const REVIEWER_WRITE_PREFIXES = ["reviews/", `${WORKTREE_HANDOFF_DIR}/`];

function reportConsistency(report: ReviewReport, run: ReviewerRun, implSha: string | null): string | null {
  if (report.mode !== run.mode) {
    return "invalid_enum_value:mode";
  }
  if (report.taskId !== run.taskId) {
    return "invalid_enum_value:task_id";
  }
  if (report.implSha !== implSha) {
    return "invalid_enum_value:impl_sha";
  }
  return null;
}

async function parseReviewOutputs(worktree: string, worktreeHandoff: string, run: ReviewerRun, implSha: string | null): Promise<ParseOutcome<ReviewReport>> {
  const handoff = parseHandoff("reviewer", await readTextOrNull(worktreeHandoff));
  if (!handoff.ok) {
    return { ok: false, error: describeHandoffError(handoff.error) };
  }
  const report = parseReviewReport(await readTextOrNull(join(worktree, reviewReportPath(run.taskId))));
  if (!report.ok) {
    return { ok: false, error: `report: ${report.error}` };
  }
  const inconsistency = reportConsistency(report.report, run, implSha);
  return inconsistency === null ? { ok: true, value: report.report } : { ok: false, error: `report: ${inconsistency}` };
}

async function archiveWorktreeHandoffs(worktree: string, handoffPath: string): Promise<void> {
  const source = join(worktree, WORKTREE_HANDOFF_DIR);
  await mkdir(dirname(handoffPath), { recursive: true });
  await cp(source, dirname(handoffPath), { recursive: true, force: true }).catch(() => undefined);
  await rm(source, { recursive: true, force: true });
}

export async function runReviewer(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: ReviewerRun): Promise<void> {
  const token = deps.lanes.tokenOf(run.taskId);
  const inputs = await laneInputs(slice, deps, context.state, run.taskId);
  const worktree = inputs.task.worktree;
  const baseSha = requireSha(inputs.task.baseSha, "baseSha");
  const implSha = run.mode === "review" ? requireSha(inputs.task.implSha, "implSha") : null;
  const handoffPath = laneHandoffPath(slice.paths.handoffsDir, run.taskId, "reviewer", run.attempt);
  const worktreeHandoff = join(worktree, WORKTREE_HANDOFF_DIR, `reviewer-${run.attempt}.md`);
  const diff = (await deps.git.run(worktree, run.mode === "review" ? ["diff", baseSha, implSha ?? "HEAD"] : ["diff", baseSha])).stdout;
  const evidenceJson = run.mode === "review" ? await readTextOrNull(join(taskHandoffDir(slice.paths.handoffsDir, run.taskId), evidenceFileName("green", run.attempt))) : null;
  const frozen = inputs.task.testsSha === null ? [] : await frozenTestFiles(deps, worktree, baseSha, inputs.task.testsSha);
  const base = { ...laneMessageInput(slice, inputs, worktreeHandoff, run.attempt, null), productDir: worktree };
  const instruction = slice.prompts.render(await slice.prompts.load("reviewer"), instructionVariables(base));
  const message = reviewerMessage({ ...base, mode: run.mode, implSha, diff, frozenTestFiles: frozen, evidenceJson, finding: run.finding, reportPath: reviewReportPath(run.taskId) });
  const trace = (entry: { readonly tool: string; readonly path: string | null }): void => slice.log(`reviewer ${run.taskId} ${entry.tool} ${entry.path ?? ""}`);
  const tools = [readFileTool(worktree, trace), listDirTool(worktree, trace), restrictedWriteFileTool(worktree, REVIEWER_WRITE_PREFIXES, trace)];
  const result = await runWithHandoffRetry<ApiRoleUsage, ReviewReport>(
    {
      role: "reviewer",
      handoffPath: worktreeHandoff,
      maxReruns: slice.config.caps.handoffRerun,
      invoke: (text) =>
        slice.apiRoles.run({ role: "reviewer", taskId: run.taskId, instruction, message: text, model: slice.config.models.default, tools, timeoutMs: slice.config.timeouts.apiRoleMs, maxOutputTokens: REVIEWER_MAX_OUTPUT_TOKENS }),
      parse: () => parseReviewOutputs(worktree, worktreeHandoff, run, implSha),
    },
    message,
  );
  await archiveWorktreeHandoffs(worktree, handoffPath);
  if (!deps.lanes.isLive(token)) {
    return;
  }
  if (!result.ok) {
    context.publish({ type: "task.failed", producer: "foreman", payload: { taskId: run.taskId, reason: "unparseable_handoff", detail: `reviewer: ${result.error}` } });
    return;
  }
  const usage = result.run;
  context.publish({
    type: "task.reviewed",
    producer: "reviewer",
    payload: {
      taskId: run.taskId,
      decision: result.parsed.decision,
      target: result.parsed.target,
      reportPath: reviewReportPath(run.taskId),
      specIds: blockingSpecIds(result.parsed),
      findingText: blockingFindingText(result.parsed),
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: usage.durationMs,
      model: usage.model,
    },
  });
}
