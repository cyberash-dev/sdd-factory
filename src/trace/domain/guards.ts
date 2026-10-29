export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function integerOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function millisOf(isoTimestamp: string): number {
  return Date.parse(isoTimestamp);
}
