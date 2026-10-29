import { createAssemblySlice } from "./assembly-stage/index.js";
import { createBuildStageSlice } from "./build-stage/index.js";
import { createDesignStageSlice } from "./design-stage/index.js";
import type { SliceFactory } from "./shared/slice.js";
import { createSpecStageSlice } from "./spec-stage/index.js";
import { createTraceSlice } from "./trace/index.js";

/* The tracer goes first so it observes every participant; the order of the others is irrelevant to the bus. */
export function stageSlices(): readonly SliceFactory[] {
  return [createTraceSlice({ env: process.env }), createSpecStageSlice(), createDesignStageSlice(), createBuildStageSlice(), createAssemblySlice()];
}
