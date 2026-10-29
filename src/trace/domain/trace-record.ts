import type { EventType } from "../../bus/domain/catalogue.js";

export const RUNTIME_EVENT_TYPES = ["inference.started", "inference.completed", "participant.joined", "participant.left"] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_PRODUCER = "runtime";

export interface TraceRecord {
  readonly seq: number;
  readonly elapsedMs: number;
  readonly type: EventType | RuntimeEventType;
  readonly runId: string;
  readonly occurredAt: string;
  readonly producer: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function isRuntimeEventType(value: unknown): value is RuntimeEventType {
  return typeof value === "string" && (RUNTIME_EVENT_TYPES as readonly string[]).includes(value);
}

export function serializeRecord(record: TraceRecord): string {
  return JSON.stringify({
    seq: record.seq,
    elapsedMs: record.elapsedMs,
    type: record.type,
    runId: record.runId,
    occurredAt: record.occurredAt,
    producer: record.producer,
    payload: record.payload,
  });
}
