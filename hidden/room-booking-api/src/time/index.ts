export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

const UTC_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00Z$/;

export function parseUtcMinute(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = UTC_MINUTE.exec(value);
  if (match === null) {
    return undefined;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const epochMs = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(epochMs);
  const exact =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute;
  return exact ? epochMs : undefined;
}

export function formatUtcMinute(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16)}:00Z`;
}

export function intervalOf(startMs: number, endMs: number): Interval {
  return { startMs, endMs };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

export function lengthMs(interval: Interval): number {
  return interval.endMs - interval.startMs;
}
