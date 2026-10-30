export const PRODUCERS = [
  "foreman",
  "spec-analyst",
  "spec-critic",
  "architect",
  "verification-designer",
  "planner",
  "test-writer",
  "implementer",
  "reviewer",
  "assembler",
  "triage",
  "tracer",
  "simple-fixer",
] as const;

export type Producer = (typeof PRODUCERS)[number];

export const RUN_ID_PATTERN = /^[a-z][a-z0-9-]*-[0-9]{8}-[0-9]{6}$/;

export type EventPayload = Readonly<Record<string, unknown>>;

export interface FactoryEvent<TType extends string = string, TPayload extends EventPayload = EventPayload> {
  readonly type: TType;
  readonly runId: string;
  readonly occurredAt: string;
  readonly producer: Producer;
  readonly payload: TPayload;
}

export interface DeliveredEvent<TType extends string = string, TPayload extends EventPayload = EventPayload>
  extends FactoryEvent<TType, TPayload> {
  readonly seq: number;
}

export type BusErrorCode =
  | "envelope_invalid"
  | "unknown_event_type"
  | "terminal_event_duplicate"
  | "producer_not_joined"
  | "state_write_failed";

export class BusError extends Error {
  override readonly name = "BusError";

  constructor(
    readonly code: BusErrorCode,
    readonly field: string | null,
    detail: string,
  ) {
    super(field === null ? `${code}: ${detail}` : `${code}: ${field}: ${detail}`);
  }
}

export function isProducer(value: unknown): value is Producer {
  return typeof value === "string" && (PRODUCERS as readonly string[]).includes(value);
}
