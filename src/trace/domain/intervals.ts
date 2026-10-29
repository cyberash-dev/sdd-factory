import { isEventType } from "../../bus/domain/catalogue.js";
import { millisOf, stringOf } from "./guards.js";
import type { TraceRecord } from "./trace-record.js";

export type IntervalKind = "participant" | "task";

export interface ActiveInterval {
  readonly kind: IntervalKind;
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

function keyOf(kind: IntervalKind, id: string): string {
  return `${kind}:${id}`;
}

/*
 * A participant is active from its first inference.started until it publishes a bus event;
 * a task lane is active from task.ready until task.approved or task.failed (bus:INV-003).
 */
export function activeIntervals(records: readonly TraceRecord[]): readonly ActiveInterval[] {
  const open = new Map<string, ActiveInterval>();
  const closed: ActiveInterval[] = [];
  const openInterval = (kind: IntervalKind, id: string, startedAt: string): void => {
    const key = keyOf(kind, id);
    if (!open.has(key)) {
      open.set(key, { kind, id, startedAt, endedAt: null });
    }
  };
  const closeInterval = (kind: IntervalKind, id: string, endedAt: string): void => {
    const key = keyOf(kind, id);
    const interval = open.get(key);
    if (interval !== undefined) {
      open.delete(key);
      closed.push({ ...interval, endedAt });
    }
  };
  for (const record of records) {
    const participant = stringOf(record.payload["participant"]);
    if (record.type === "inference.started" && participant !== null) {
      openInterval("participant", participant, record.occurredAt);
      continue;
    }
    if (!isEventType(record.type)) {
      continue;
    }
    const taskId = stringOf(record.payload["taskId"]);
    if (record.type === "task.ready" && taskId !== null) {
      openInterval("task", taskId, record.occurredAt);
    } else if ((record.type === "task.approved" || record.type === "task.failed") && taskId !== null) {
      closeInterval("task", taskId, record.occurredAt);
    }
    closeInterval("participant", record.producer, record.occurredAt);
  }
  return [...closed, ...open.values()].sort((left, right) => millisOf(left.startedAt) - millisOf(right.startedAt));
}

export function overlaps(left: ActiveInterval, right: ActiveInterval): boolean {
  const leftEnd = left.endedAt === null ? Number.POSITIVE_INFINITY : millisOf(left.endedAt);
  const rightEnd = right.endedAt === null ? Number.POSITIVE_INFINITY : millisOf(right.endedAt);
  return millisOf(left.startedAt) < rightEnd && millisOf(right.startedAt) < leftEnd;
}
