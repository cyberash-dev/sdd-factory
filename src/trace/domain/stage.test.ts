import { describe, expect, it } from "vitest";
import { stageOfEvent, stageOpenedBy } from "./stage.js";

describe("stageOfEvent", () => {
  it.each([
    ["run.started", {}, "workspace"],
    ["workspace.ready", {}, "workspace"],
    ["spec.reviewed", {}, "spec"],
    ["design.rework", {}, "design"],
    ["task.reviewed", {}, "build"],
    ["assembly.triaged", {}, "assembly"],
    ["run.published", {}, "publish"],
    ["run.failed", { stage: "build" }, "build"],
    ["human.intervention", {}, null],
  ] as const)("maps %s to stage %s", (type, payload, expected) => {
    expect(stageOfEvent(type, payload)).toBe(expected);
  });
});

describe("stageOpenedBy", () => {
  it.each([
    ["workspace.ready", {}, "spec"],
    ["spec.approved", {}, "design"],
    ["design.tasks.ready", {}, "build"],
    ["assembly.started", {}, "assembly"],
    ["run.failed", { stage: "design" }, "design"],
    ["task.approved", {}, null],
  ] as const)("reports the stage the run enters after %s", (type, payload, expected) => {
    expect(stageOpenedBy(type, payload)).toBe(expected);
  });
});
