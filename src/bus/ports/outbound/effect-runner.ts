import type { RunState } from "../../domain/run-state.js";
import type { Effect, PendingEvent } from "../../domain/transition.js";

export interface EffectContext {
  readonly state: RunState;
  publish(pending: PendingEvent): void;
}

export interface EffectRunner {
  run(effect: Effect, context: EffectContext): Promise<void>;
}
