import type { EventPayload } from "../../bus/domain/envelope.js";

export class PayloadShapeError extends Error {
  override readonly name = "PayloadShapeError";
}

export function stringField(payload: EventPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new PayloadShapeError(`payload.${key}: expected string`);
  }
  return value;
}

export function nullableStringField(payload: EventPayload, key: string): string | null {
  const value = payload[key];
  if (value !== null && typeof value !== "string") {
    throw new PayloadShapeError(`payload.${key}: expected string or null`);
  }
  return value;
}

export function stringArrayField(payload: EventPayload, key: string): readonly string[] {
  const value = payload[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new PayloadShapeError(`payload.${key}: expected string[]`);
  }
  return value;
}

export function integerField(payload: EventPayload, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PayloadShapeError(`payload.${key}: expected integer`);
  }
  return value;
}
