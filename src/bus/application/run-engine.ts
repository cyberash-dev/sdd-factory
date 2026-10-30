import type { EventType } from "../domain/catalogue.js";
import { BusError, type DeliveredEvent } from "../domain/envelope.js";
import { isTerminalStatus, stageOf, type RunState } from "../domain/run-state.js";
import { dedupeKey, reduce, type PendingEvent, type ReduceOutcome, type TransitionRule } from "../domain/transition.js";
import type { EffectRunner } from "../ports/outbound/effect-runner.js";
import type { EventPublisher } from "../ports/outbound/event-publisher.js";
import type { StateStore } from "../ports/outbound/state-store.js";

export interface RunEngineDeps {
  readonly initialState: RunState;
  readonly rules: readonly TransitionRule[];
  readonly store: StateStore;
  readonly publisher: EventPublisher;
  readonly effects: EffectRunner;
  readonly log: (line: string) => void;
}

export type ConsumeOutcome = ReduceOutcome["kind"] | "terminal_ignored";

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export class RunEngine {
  private current: RunState;
  private readonly consumed = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: RunEngineDeps) {
    this.current = deps.initialState;
  }

  get state(): RunState {
    return this.current;
  }

  consume(event: DeliveredEvent<EventType>): Promise<ConsumeOutcome> {
    const next = this.queue.then(() => this.handle(event));
    this.queue = next.catch(() => undefined);
    return next;
  }

  publish(pending: PendingEvent): void {
    this.deps.publisher.publish(pending);
  }

  fail(stageHint: RunState["status"] | null, reason: "runtime_error" | "trace_write_failed" | "terminated", detail: string): void {
    if (isTerminalStatus(this.current.status)) {
      this.deps.log(`warning after terminal event: ${reason}: ${detail}`);
      return;
    }
    const stage = stageOf(stageHint ?? this.current.status, this.current.failure);
    this.deps.publisher.publish({ type: "run.failed", producer: "foreman", payload: { stage, reason, detail } });
  }

  private async handle(event: DeliveredEvent<EventType>): Promise<ConsumeOutcome> {
    if (isTerminalStatus(this.current.status)) {
      this.deps.log(`terminal_ignored ${event.type} seq=${event.seq}`);
      return "terminal_ignored";
    }
    const outcome = reduce(this.deps.rules, this.current, event, this.consumed);
    if (outcome.kind !== "applied") {
      this.deps.log(`${outcome.kind} ${event.type} seq=${event.seq}`);
      return outcome.kind;
    }
    const key = dedupeKey(event);
    if (key !== null) {
      this.consumed.add(key);
    }
    try {
      await this.deps.store.write(outcome.result.state);
    } catch (error) {
      this.current = outcome.result.state;
      this.fail(null, "runtime_error", new BusError("state_write_failed", null, errorText(error)).message);
      return "applied";
    }
    this.current = outcome.result.state;
    this.deps.log(`applied ${outcome.rule} ${event.type} seq=${event.seq}`);
    for (const pending of outcome.result.emits) {
      this.deps.publisher.publish(pending);
    }
    for (const effect of outcome.result.effects) {
      this.runEffect(effect);
    }
    return "applied";
  }

  private runEffect(effect: Parameters<EffectRunner["run"]>[0]): void {
    const context = { state: this.current, publish: (pending: PendingEvent) => this.publish(pending) };
    this.deps.effects.run(effect, context).catch((error: unknown) => {
      this.fail(null, "runtime_error", `effect ${effect.kind}: ${errorText(error)}`);
    });
  }
}
