import type { SliceFactory } from "./shared/slice.js";
import { createSpecStageSlice } from "./spec-stage/index.js";

/* Stage slices join here as their partitions land; the factory slice is composed separately. */
export function stageSlices(): readonly SliceFactory[] {
  return [createSpecStageSlice()];
}
