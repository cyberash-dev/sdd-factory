import {
  createHuman,
  defineRuntime,
  RuntimeState,
  SemanticEvent,
  SituationSpecification,
  type Human,
  type InferenceRunner,
  type SituationContext,
  type SituationHandler,
} from "@mozaik-ai/core";
import { isEventType, TERMINAL_EVENT_TYPES, validateEvent, type EventType } from "../../domain/catalogue.js";
import { BusError, isProducer, type DeliveredEvent, type Producer } from "../../domain/envelope.js";
import type { PendingEvent } from "../../domain/transition.js";
import type { EventPublisher } from "../../ports/outbound/event-publisher.js";

export class FactoryRuntimeState extends RuntimeState {
  constructor(readonly runId: string) {
    super();
  }
}

export type DeliveredHandler = (event: DeliveredEvent<EventType>) => void;

export type ReactorHandlers = Partial<Record<EventType, DeliveredHandler>>;

interface MozaikEventPayload {
  readonly runId: string;
  readonly producer: Producer;
  readonly seq: number;
  readonly payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMozaikEventPayload(value: unknown): value is MozaikEventPayload {
  return (
    isRecord(value) &&
    typeof value["runId"] === "string" &&
    isProducer(value["producer"]) &&
    typeof value["seq"] === "number" &&
    isRecord(value["payload"])
  );
}

export function toDeliveredEvent(event: SemanticEvent): DeliveredEvent<EventType> | null {
  if (!isEventType(event.type) || !isMozaikEventPayload(event.payload)) {
    return null;
  }
  return {
    type: event.type,
    runId: event.payload.runId,
    occurredAt: event.occurredAt.toISOString(),
    producer: event.payload.producer,
    seq: event.payload.seq,
    payload: event.payload.payload,
  };
}

class FactoryEventSpecification extends SituationSpecification {
  constructor(private readonly types: ReadonlySet<string>) {
    super();
  }

  isSatisfiedBy({ event }: SituationContext): boolean {
    return this.types.has(event.type);
  }
}

export function createReactor(name: Producer, handlers: ReactorHandlers): Human {
  const situationHandlers: SituationHandler[] = Object.entries(handlers).map(([type, handler]) => ({
    specification: new FactoryEventSpecification(new Set([type])),
    processor: {
      apply({ event }: SituationContext): void {
        const delivered = toDeliveredEvent(event);
        if (delivered !== null) {
          handler(delivered);
        }
      },
    },
  }));
  return createHuman({ name, capabilities: [], handlers: situationHandlers });
}

export type RuntimeObserverHandler = (event: SemanticEvent) => void;

class AnyEventSpecification extends SituationSpecification {
  isSatisfiedBy(): boolean {
    return true;
  }
}

export function createRuntimeObserver(name: string, handler: RuntimeObserverHandler): Human {
  return createHuman({
    name,
    capabilities: [],
    handlers: [{ specification: new AnyEventSpecification(), processor: { apply: ({ event }: SituationContext): void => handler(event) } }],
  });
}

export interface FactoryRuntimeOptions {
  readonly inferenceRunner?: InferenceRunner;
}

export interface FactoryRuntime {
  readonly state: FactoryRuntimeState;
  readonly publisher: EventPublisher;
  join(participant: Human): void;
  leave(participant: Human): void;
  readonly mozaik: ReturnType<typeof defineRuntime<FactoryRuntimeState>>;
}

export function createFactoryRuntime(runId: string, options: FactoryRuntimeOptions = {}): FactoryRuntime {
  const mozaik = defineRuntime<FactoryRuntimeState>();
  const state = new FactoryRuntimeState(runId);
  mozaik.initializeRuntime(options.inferenceRunner === undefined ? { state } : { state, inferenceRunnerConfig: { runner: options.inferenceRunner } });
  const bus = createHuman({ name: "bus", capabilities: [], handlers: [] });
  mozaik.join(bus);
  let seq = 0;
  let terminalPublished = false;
  const publisher: EventPublisher = {
    publish(pending: PendingEvent): DeliveredEvent<EventType> {
      const occurredAt = new Date();
      const candidate = { ...pending, runId, occurredAt: occurredAt.toISOString() };
      validateEvent(candidate);
      if (TERMINAL_EVENT_TYPES.includes(candidate.type)) {
        if (terminalPublished) {
          throw new BusError("terminal_event_duplicate", "type", candidate.type);
        }
        terminalPublished = true;
      }
      seq += 1;
      const delivered: DeliveredEvent<EventType> = { ...candidate, seq };
      const mozaikPayload: MozaikEventPayload = { runId, producer: pending.producer, seq, payload: { ...pending.payload } };
      mozaik.sendEvent(new SemanticEvent(candidate.type, bus.getId(), occurredAt, mozaikPayload), bus.getId());
      return delivered;
    },
  };
  return {
    state,
    publisher,
    mozaik,
    join: (participant) => mozaik.join(participant),
    leave: (participant) => mozaik.leave(participant),
  };
}
