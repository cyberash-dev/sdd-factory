import type { RunState } from "../../bus/domain/run-state.js";
import type { Effect, PendingEvent } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import type { SliceContext } from "../../shared/slice.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import { productRelative } from "../domain/firewall.js";
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

export async function specSourceInline(slice: SliceContext): Promise<{ readonly path: string; readonly inline: string }> {
  const relativePath = productRelative(slice.paths.productDir, slice.paths.specSourcePath);
  if (!relativePath.startsWith("..")) {
    return { path: relativePath, inline: "" };
  }
  const text = (await readTextOrNull(slice.paths.specSourcePath)) ?? "";
  return { path: slice.paths.specSourcePath, inline: `The source spec is outside product_dir; its content follows verbatim, do not read it with a tool:\n\n${text}\n` };
}
