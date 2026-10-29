import { createDesignStageSlice } from "./design-stage/index.js";
import type { SliceFactory } from "./shared/slice.js";
import { createSpecStageSlice } from "./spec-stage/index.js";
import { createTraceSlice } from "./trace/index.js";

/* Stage slices join here as their partitions land; the tracer goes first so it observes every participant. */
export function stageSlices(): readonly SliceFactory[] {
  return [createTraceSlice({ env: process.env }), createSpecStageSlice(), createDesignStageSlice()];
}
