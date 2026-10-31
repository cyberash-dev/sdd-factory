import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { createRunState, createTaskState } from "../../src/bus/domain/run-state.js";

async function surfaceRecord(id: string): Promise<{ version: string; members: string[] }> {
  const text = await readFile(new URL("../../spec/bus.md", import.meta.url), "utf8");
  const blocks = [...text.matchAll(/```yaml\n---\n([\s\S]*?)\n---\n```/g)].map((match) => YAML.parse(match[1] ?? ""));
  const surface = blocks.find((block) => typeof block === "object" && block !== null && "id" in block && block.id === id);
  if (typeof surface !== "object" || surface === null || !("members" in surface) || !Array.isArray(surface.members)) {
    throw new Error(`surface ${id} not found`);
  }
  return { version: String("version" in surface ? surface.version : ""), members: surface.members.filter((member: unknown): member is string => typeof member === "string") };
}

describe("bus surfaces after the member, state and roster deltas", () => {
  // @covers bus:DLT-001
  it("list the reacting behaviours next to the event and handoff contracts", async () => {
    const events = await surfaceRecord("bus:SUR-001");
    const handoffs = await surfaceRecord("bus:SUR-002");

    expect([["bus:BEH-001", "bus:BEH-002", "bus:BEH-005", "bus:BEH-006"].every((id) => events.members.includes(id)), handoffs.version, handoffs.members.sort()]).toEqual([
      true,
      "0.2.0",
      ["bus:BEH-003", "bus:BEH-004", "bus:CTR-007", "bus:CTR-008"],
    ]);
  });

  // @covers bus:DLT-004
  it("carries a version past 0.3 after the terminated reason joined the lifecycle contract", async () => {
    const events = await surfaceRecord("bus:SUR-001");

    const [major, minor] = events.version.split(".").map(Number);
    expect([major, (minor ?? 0) >= 4]).toEqual([0, true]);
  });

  // @covers bus:DLT-005
  it("carries a version past 0.4 with the fixer events contract as a factory-events member", async () => {
    const events = await surfaceRecord("bus:SUR-001");

    const [major, minor] = events.version.split(".").map(Number);
    expect([major, (minor ?? 0) >= 5, events.members.includes("bus:CTR-009")]).toEqual([0, true, true]);
  });

  // @covers bus:DLT-006
  // @covers bus:DLT-007
  it("carries a version past 0.5 after the collision-free dedupe keys and the stalled reason", async () => {
    const events = await surfaceRecord("bus:SUR-001");

    const [major, minor] = events.version.split(".").map(Number);
    expect([major, (minor ?? 0) >= 6]).toEqual([0, true]);
  });

  // @covers bus:DLT-008
  it("carries a version past 0.6 after design.rework gained the finding path and spec ids", async () => {
    const events = await surfaceRecord("bus:SUR-001");

    const [major, minor] = events.version.split(".").map(Number);
    expect([major, (minor ?? 0) >= 7]).toEqual([0, true]);
  });

  // @covers bus:DLT-009
  // @covers bus:DLT-010
  it("carries version 0.9.0 after assembly.verified gained the build step and spec.gate_failed joined the catalogue", async () => {
    const events = await surfaceRecord("bus:SUR-001");

    expect(events.version).toBe("0.9.0");
  });

  // @covers bus:DLT-003
  it("carries the participant roster behaviour as a factory-events member past version 0.2.0", async () => {
    const events = await surfaceRecord("bus:SUR-001");

    const [major, minor] = events.version.split(".").map(Number);
    expect([major, (minor ?? 0) >= 3, events.members.includes("bus:BEH-007")]).toEqual([0, true, true]);
  });

  // @covers bus:DLT-002
  it("gives the state snapshot the design progress, handoff re-run and assumption counters with zero values", () => {
    const state = createRunState({ runId: "todo-cli-20261029-120000", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
    const task = createTaskState({ worktree: "/wt/T-001", covers: [], writes: [], dependsOn: ["T-000"] });

    expect([state.design, state.stageHandoffReruns, state.assumptionsByRecord, task.handoffReruns, task.dependsOn]).toEqual([{ techReady: false, verificationReady: false, tasksPath: null }, {}, {}, {}, ["T-000"]]);
  });
});
