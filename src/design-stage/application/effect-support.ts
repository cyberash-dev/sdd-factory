import { isAbsolute } from "node:path";
import type { RunState } from "../../bus/domain/run-state.js";
import type { Effect, PendingEvent } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { RoleUsage } from "../domain/payloads.js";

export const TECH_MD = "design/tech.md";
export const VERIFICATION_MD = "design/verification.md";
export const TASKS_JSON = "design/tasks.json";

export function effectInteger(effect: Effect, field: string, fallback: number): number {
  const value = effect[field];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : fallback;
}

export function effectStrings(effect: Effect, field: string): readonly string[] {
  const value = effect[field];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

/* The finding may arrive as text (own reworks) or as the task.finding payload object (build-stage reworks). */
export function reworkFindingText(effect: Effect): string {
  const candidates = [effect["reworkFinding"], effect["finding"]];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    if (typeof candidate === "object" && candidate !== null) {
      return JSON.stringify(candidate);
    }
  }
  return "";
}

/* design-stage:DLT-010: a lane finding's handoff path is absolute; a review report path is worktree-relative and unreadable from here. */
async function findingFileText(effect: Effect): Promise<string | null> {
  const findingPath = effect["findingPath"];
  return typeof findingPath === "string" && isAbsolute(findingPath) ? readTextOrNull(findingPath) : null;
}

/* design-stage:DLT-010: a repair routed from a lane finding hands the role the finding itself, not only the routing reason. */
export async function reworkFindingWithFile(effect: Effect): Promise<string> {
  const reason = reworkFindingText(effect);
  const findingFile = await findingFileText(effect);
  if (findingFile === null) {
    return reason;
  }
  const specIds = effectStrings(effect, "specIds");
  const specIdsLine = specIds.length === 0 ? [] : [`spec_ids: ${specIds.join(", ")}`];
  return [reason, ...specIdsLine, "", findingFile.trimEnd()].join("\n");
}

/* bus:CTR-004 keys design.rework on attempt alone, so the attempt is the design-stage-wide rework ordinal. */
export function designReworkAttempt(state: RunState): number {
  return state.stageAttempts.plannerRecuts + state.stageAttempts.architectRepairs + 1;
}

export function publishBlocked(context: EffectContext, reason: string, detail: string, usage: RoleUsage, reruns: number): void {
  context.publish({ type: "design.blocked", producer: "foreman", payload: { reason, detail, usage, handoffReruns: reruns } });
}

export function pending(type: PendingEvent["type"], payload: PendingEvent["payload"]): PendingEvent {
  return { type, producer: "foreman", payload };
}
