import type { Producer } from "../../bus/domain/envelope.js";
import type { PendingEvent } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import type { SpecBlockedReason } from "../effect-kinds.js";
import type { CommandResult, CommandRunner } from "../ports/command-runner.js";
import type { StageClock } from "./stage-clock.js";

export interface StageDeps {
  readonly commands: CommandRunner;
  readonly clock: StageClock;
}

const TAIL_CHARS = 1200;

export function outputTail(result: CommandResult): string {
  return `${result.stdout}${result.stderr}`.trim().slice(-TAIL_CHARS);
}

export function specBlocked(producer: Producer, reason: SpecBlockedReason, detail: string): PendingEvent {
  return { type: "spec.blocked", producer, payload: { reason, detail } };
}

export function concludeStage(deps: StageDeps, context: EffectContext, pending: PendingEvent): void {
  deps.clock.stop();
  context.publish(pending);
}
