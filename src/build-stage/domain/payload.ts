import type { EventPayload } from "../../bus/domain/envelope.js";

export class PayloadFieldError extends Error {
  override readonly name = "PayloadFieldError";
}

export function stringField(payload: EventPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new PayloadFieldError(`payload.${key}: expected string`);
  }
  return value;
}

export function stringOrNullField(payload: EventPayload, key: string): string | null {
  const value = payload[key];
  if (value !== null && typeof value !== "string") {
    throw new PayloadFieldError(`payload.${key}: expected string or null`);
  }
  return value ?? null;
}

export function integerField(payload: EventPayload, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PayloadFieldError(`payload.${key}: expected integer`);
  }
  return value;
}

export function numberOrNullField(payload: EventPayload, key: string): number | null {
  const value = payload[key];
  if (value !== null && typeof value !== "number") {
    throw new PayloadFieldError(`payload.${key}: expected number or null`);
  }
  return value ?? null;
}

export function stringsField(payload: EventPayload, key: string): readonly string[] {
  const value = payload[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new PayloadFieldError(`payload.${key}: expected string[]`);
  }
  return value;
}

export function optionalStringsField(payload: EventPayload, key: string): readonly string[] {
  return Object.hasOwn(payload, key) ? stringsField(payload, key) : [];
}

export function booleanField(payload: EventPayload, key: string): boolean {
  const value = payload[key];
  if (typeof value !== "boolean") {
    throw new PayloadFieldError(`payload.${key}: expected boolean`);
  }
  return value;
}
