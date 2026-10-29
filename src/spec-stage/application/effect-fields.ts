import type { Effect } from "../../bus/domain/transition.js";
import { isStringArray } from "../domain/guards.js";

export function effectInteger(effect: Effect, field: string): number {
  const value = effect[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`effect ${effect.kind}: ${field} must be a positive integer`);
  }
  return value;
}

export function effectString(effect: Effect, field: string): string {
  const value = effect[field];
  if (typeof value !== "string") {
    throw new Error(`effect ${effect.kind}: ${field} must be a string`);
  }
  return value;
}

export function effectStringOrNull(effect: Effect, field: string): string | null {
  const value = effect[field];
  if (value === null || value === undefined) {
    return null;
  }
  return effectString(effect, field);
}

export function effectStrings(effect: Effect, field: string): readonly string[] {
  const value = effect[field];
  if (!isStringArray(value)) {
    throw new Error(`effect ${effect.kind}: ${field} must be a list of strings`);
  }
  return value;
}
