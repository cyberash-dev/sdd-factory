import { RUN_STAGES, type EventType } from "../../bus/domain/catalogue.js";
import type { RunStage } from "../../bus/domain/run-state.js";

export function isRunStage(value: unknown): value is RunStage {
  return typeof value === "string" && (RUN_STAGES as readonly string[]).includes(value);
}

const STAGE_BY_TYPE_PREFIX: Readonly<Record<string, RunStage>> = {
  run: "workspace",
  workspace: "workspace",
  spec: "spec",
  design: "design",
  task: "build",
  assembly: "assembly",
};

const STAGE_OPENED_BY: Partial<Record<EventType, RunStage>> = {
  "run.started": "workspace",
  "workspace.ready": "spec",
  "spec.approved": "design",
  "design.tasks.ready": "build",
  "assembly.started": "assembly",
  "run.published": "publish",
};

function failedStageOf(payload: Readonly<Record<string, unknown>>): RunStage | null {
  const stage = payload["stage"];
  return isRunStage(stage) ? stage : null;
}

/* The stage an event belongs to; run.failed belongs to the stage named in its payload. */
export function stageOfEvent(type: EventType, payload: Readonly<Record<string, unknown>>): RunStage | null {
  if (type === "run.failed") {
    return failedStageOf(payload);
  }
  if (type === "run.published") {
    return "publish";
  }
  if (type === "human.intervention") {
    return null;
  }
  return STAGE_BY_TYPE_PREFIX[type.slice(0, type.indexOf("."))] ?? null;
}

/* The stage the run is in once the event has been applied (mirrors the bus run-status progression). */
export function stageOpenedBy(type: EventType, payload: Readonly<Record<string, unknown>>): RunStage | null {
  if (type === "run.failed") {
    return failedStageOf(payload);
  }
  return STAGE_OPENED_BY[type] ?? null;
}
