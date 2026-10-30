import { dirname } from "node:path";
import type { LaneParticipant, LaneRole } from "../../bus/adapters/mozaik/roster.js";
import { laneEnvironment, type CliRoleOutcome } from "../../shared/llm/cli-role-runner.js";
import type { SliceContext } from "../../shared/slice.js";
import type { LaneDeps } from "./lane-deps.js";

export const CLAUDE_BINARY = "claude";
export const LANE_MODEL_FALLBACK = "claude-code";
export const RATE_LIMIT_RETRY_DELAY_MS = 30_000;
const RATE_LIMITED = /rate.?limit|429|overloaded/i;

export interface CliLaneRequest {
  readonly worktree: string;
  readonly handoffPath: string;
  readonly instruction: string;
  readonly message: string;
}

export interface CostFields {
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export function isRateLimited(outcome: CliRoleOutcome): boolean {
  return outcome.result !== null && outcome.result.isError && RATE_LIMITED.test(outcome.result.resultText);
}

export function costFieldsOf(outcome: CliRoleOutcome): CostFields {
  if (outcome.result === null) {
    return { costUsd: null, inputTokens: 0, outputTokens: 0, durationMs: outcome.durationMs };
  }
  return { costUsd: outcome.result.costUsd, inputTokens: outcome.result.inputTokens, outputTokens: outcome.result.outputTokens, durationMs: outcome.result.durationMs };
}

/* build-stage:BEH-017: the lane participant lives from before the subprocess starts to after the last event. */
export async function withLaneParticipant<T>(slice: SliceContext, role: LaneRole, taskId: string, body: (lane: LaneParticipant) => Promise<T>): Promise<T> {
  const lane = slice.runtime.joinLane(role, taskId);
  try {
    return await body(lane);
  } finally {
    slice.runtime.leaveLane(lane);
  }
}

/* build-stage:EXT-001: one retry after a rate-limited result, without counting an attempt. */
export async function runCliLane(slice: SliceContext, deps: LaneDeps, request: CliLaneRequest, lane: LaneParticipant): Promise<CliRoleOutcome> {
  const configuredModel = slice.config.models.lane ?? LANE_MODEL_FALLBACK;
  const run = async (): Promise<CliRoleOutcome> => {
    /* build-stage:DLT-001: the subprocess is reported like a loop inference so Mozaik Cloud counts lane work. */
    slice.runtime.publishRuntimeEvent(lane.id, "inference.started", { model: configuredModel });
    const outcome = await slice.cliRoles.run({
      binary: CLAUDE_BINARY,
      cwd: request.worktree,
      prompt: `${request.instruction}\n\n---\n\n${request.message}`,
      addDirs: [request.worktree, dirname(request.handoffPath)],
      model: slice.config.models.lane,
      timeoutMs: slice.config.timeouts.cliRoleMs,
      env: laneEnvironment(process.env),
    });
    const cost = costFieldsOf(outcome);
    slice.runtime.publishRuntimeEvent(lane.id, "inference.completed", {
      model: outcome.result?.dominantModel ?? configuredModel,
      tokenUsage: { inputTokens: cost.inputTokens, outputTokens: cost.outputTokens },
      items: [],
    });
    return outcome;
  };
  const first = await run();
  if (!isRateLimited(first)) {
    return first;
  }
  slice.log(`lane rate-limited; retrying once after ${RATE_LIMIT_RETRY_DELAY_MS} ms`);
  await deps.delay(RATE_LIMIT_RETRY_DELAY_MS);
  return run();
}
