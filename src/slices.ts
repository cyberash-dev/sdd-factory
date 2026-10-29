import type { SliceFactory } from "./shared/slice.js";

/* Stage slices join here as their partitions land; the factory slice is composed separately. */
export function stageSlices(): readonly SliceFactory[] {
  return [];
}
