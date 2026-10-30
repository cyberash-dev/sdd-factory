import { dirname } from "node:path";
import type { LaneParticipant, LaneRole } from "../../bus/adapters/mozaik/roster.js";
import { laneEffortFor, laneModelFor } from "../config.js";
import { createRedactor } from "../redaction.js";
import type { SliceContext } from "../slice.js";
import { isTerminatedOutcome, laneEnvironment, type CliRoleOutcome } from "./cli-role-runner.js";

export const CLAUDE_BINARY = "claude";
export const LANE_MODEL_FALLBACK = "claude-code";
export const RATE_LIMIT_RETRY_DELAY_MS = 30_000;
const RATE_LIMITED = /rate.?limit|429|overloaded/i;

export interface LaneClock {
  readonly delay: (ms: number) => Promise<void>;
}

/* handoffPath is null for a lane that writes no handoff (the simple-fixer); its directory is then not added. */
export interface CliLaneRequest {
  readonly worktree: string;
  readonly handoffPath: string | null;
  readonly instruction: string;
  readonly message: string;
  readonly transcriptPath: string;
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
export async function withLaneParticipant<T>(slice: SliceContext, role: LaneRole, unit: string, body: (lane: LaneParticipant) => Promise<T>): Promise<T> {
  const lane = slice.runtime.joinLane(role, unit);
  try {
    return await body(lane);
  } finally {
    slice.runtime.leaveLane(lane);
  }
}

/* build-stage:EXT-001: one retry after a rate-limited result, without counting an attempt. */
export async function runCliLane(slice: SliceContext, deps: LaneClock, request: CliLaneRequest, lane: LaneParticipant): Promise<CliRoleOutcome> {
  const laneModel = laneModelFor(slice.config.models, lane.role);
  const configuredModel = laneModel ?? LANE_MODEL_FALLBACK;
  const run = async (): Promise<CliRoleOutcome> => {
    /* build-stage:DLT-001: the subprocess is reported like a loop inference so Mozaik Cloud counts lane work. */
    slice.runtime.publishRuntimeEvent(lane.id, "inference.started", { model: configuredModel });
    const outcome = await slice.cliRoles.run({
      binary: CLAUDE_BINARY,
      cwd: request.worktree,
      prompt: `${request.instruction}\n\n---\n\n${request.message}`,
      addDirs: request.handoffPath === null ? [request.worktree] : [request.worktree, dirname(request.handoffPath)],
      model: laneModel,
      effort: laneEffortFor(slice.config.models, lane.role),
      timeoutMs: slice.config.timeouts.cliRoleMs,
      env: laneEnvironment(process.env),
      transcript: { path: request.transcriptPath, redact: createRedactor(process.env) },
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
  if (!isRateLimited(first) || isTerminatedOutcome(first)) {
    return first;
  }
  slice.log(`lane rate-limited; retrying once after ${RATE_LIMIT_RETRY_DELAY_MS} ms`);
  await deps.delay(RATE_LIMIT_RETRY_DELAY_MS);
  return run();
}
