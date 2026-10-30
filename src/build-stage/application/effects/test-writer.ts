import { describeHandoffError, parseHandoff, type ParsedHandoff } from "../../../bus/domain/handoff.js";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../../shared/fs/text.js";
import { isTerminatedOutcome, type CliRoleOutcome } from "../../../shared/llm/cli-role-runner.js";
import type { SliceContext } from "../../../shared/slice.js";
import { firewallViolations } from "../../domain/context-firewall.js";
import { laneHandoffPath } from "../../domain/handoff-paths.js";
import { instructionVariables, testWriterMessage, techExcerptOf, type LaneMessageInput } from "../../domain/lane-messages.js";
import type { ReworkFinding } from "../../domain/rules/support.js";
import { costFieldsOf, runCliLane, withLaneParticipant } from "../cli-lane.js";
import { runWithHandoffRetry, type ParseOutcome } from "../handoff-roundtrip.js";
import type { LaneDeps } from "../lane-deps.js";
import { laneInputs, reworkFindingText, type LaneInputs } from "../lane-inputs.js";

export interface TestWriterRun {
  readonly taskId: string;
  readonly attempt: number;
  readonly reworkFinding: ReworkFinding | null;
}

export function laneMessageInput(slice: SliceContext, inputs: LaneInputs, handoffPath: string, attempt: number, reworkFinding: string | null): LaneMessageInput {
  return {
    taskId: inputs.entry.id,
    slug: slice.slug,
    worktree: inputs.task.worktree,
    productDir: slice.paths.productDir,
    handoffPath,
    attempt,
    specRecords: inputs.specRecords,
    verificationBlocks: inputs.verificationBlocks,
    techExcerpt: techExcerptOf(inputs.modules),
    stubPaths: inputs.stubPaths,
    taskEntryJson: JSON.stringify(inputs.entry, null, 2),
    testCmd: inputs.tooling.testCmd,
    typecheckCmd: inputs.tooling.typecheckCmd,
    reworkFinding,
  };
}

export function parseLaneHandoff(role: "test-writer" | "implementer", lastRun: CliRoleOutcome | null, text: string | null): ParseOutcome<ParsedHandoff> {
  if (lastRun !== null && lastRun.result !== null && lastRun.result.isError) {
    return { ok: false, error: `result_error: ${lastRun.result.resultText.slice(0, 200)}` };
  }
  const parsed = parseHandoff(role, text);
  return parsed.ok ? { ok: true, value: parsed.handoff } : { ok: false, error: describeHandoffError(parsed.error) };
}

export async function runTestWriter(slice: SliceContext, deps: LaneDeps, context: EffectContext, run: TestWriterRun): Promise<void> {
  const token = deps.lanes.tokenOf(run.taskId);
  const inputs = await laneInputs(slice, deps, context.state, run.taskId);
  const handoffPath = laneHandoffPath(slice.paths.handoffsDir, run.taskId, "test-writer", run.attempt);
  const messageInput = laneMessageInput(slice, inputs, handoffPath, run.attempt, await reworkFindingText(run.reworkFinding));
  const instruction = slice.prompts.render(await slice.prompts.load("test-writer"), instructionVariables(messageInput));
  let lastRun: CliRoleOutcome | null = null;
  await withLaneParticipant(slice, "test-writer", run.taskId, async (lane) => {
    const result = await runWithHandoffRetry(
      {
        role: "test-writer",
        handoffPath,
        maxReruns: slice.config.caps.handoffRerun,
        invoke: async (message) => {
          lastRun = await runCliLane(slice, deps, { worktree: inputs.task.worktree, handoffPath, instruction, message }, lane);
          return lastRun;
        },
        isTerminated: isTerminatedOutcome,
        parse: async () => parseLaneHandoff("test-writer", lastRun, await readTextOrNull(handoffPath)),
      },
      testWriterMessage(messageInput),
    );
    if (!deps.lanes.isLive(token)) {
      slice.log(`test-writer result dropped for cancelled lane ${run.taskId}`);
      return;
    }
    if (!result.ok && result.terminated === true) {
      slice.log(`test-writer ${run.taskId} ended by a termination signal; nothing published`);
      return;
    }
    if (!result.ok) {
      context.publish({ type: "task.failed", producer: "foreman", payload: { taskId: run.taskId, reason: "unparseable_handoff", detail: `test-writer: ${result.error}` } });
      return;
    }
    const frontmatter = result.parsed.frontmatter;
    if (frontmatter["status"] === "blocked") {
      context.publish({ type: "task.failed", producer: "test-writer", payload: { taskId: run.taskId, reason: "blocked", detail: `test-writer: ${String(frontmatter["blocked_reason"] ?? "")}` } });
      return;
    }
    const violations = firewallViolations(result.run.toolUses, inputs.task.worktree, inputs.stubPaths);
    context.publish({ type: "task.tests_written", producer: "test-writer", payload: { taskId: run.taskId, attempt: run.attempt, handoffPath, ...costFieldsOf(result.run), firewallViolations: violations } });
  });
}
