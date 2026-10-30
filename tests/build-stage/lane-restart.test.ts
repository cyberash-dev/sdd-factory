import { describe, expect, it } from "vitest";
import type { DesignBundle } from "../../src/build-stage/index.js";
import { aModule, greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { laneState, provisionLane, runLaneEffect } from "./support/lanes.js";
import { aProductRepo } from "./support/product.js";
import { scriptedCliRoles } from "./support/runners.js";
import { buildingState } from "./support/state.js";

const REPAIRED_INTERFACE = "export function greet(name: string, punctuation: string): string;";

function switchableDesign(initial: DesignBundle): { readonly source: { load(): Promise<DesignBundle> }; switchTo(next: DesignBundle): void } {
  let current = initial;
  return {
    source: { load: async () => current },
    switchTo: (next) => {
      current = next;
    },
  };
}

describe("lane restart and re-cut liveness", () => {
  // @covers build-stage:DLT-008
  // @covers design-stage:BEH-004
  it("gives the restarted test-writer the design the architect repaired after the lane started", async () => {
    const design = switchableDesign(greeterDesign());
    const cliRoles = scriptedCliRoles(async () => undefined);
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), designSource: design.source, cliRoles });
    const lane = await provisionLane(harness);
    design.switchTo(greeterDesign(undefined, [aModule({ interfaceSource: REPAIRED_INTERFACE })]));

    await runLaneEffect(harness, "build.restart-lane", { taskId: "T-001", attempt: 2, reworkFinding: { reason: "architect_repair: greeter:BEH-001", findingPath: null } }, laneState(lane, { attempts: { implementer: 0, testWriter: 2 } }));

    expect(cliRoles.requests[0]?.prompt.includes(REPAIRED_INTERFACE)).toBe(true);
  });

  // @covers build-stage:DLT-008
  // @covers build-stage:BEH-009
  it("drops the result of a running lane whose task the re-cut removed", async () => {
    const state = buildingState({});
    let published: Awaited<ReturnType<typeof runLaneEffect>> = [];
    const cliRoles = scriptedCliRoles(async () => {
      published = await runLaneEffect(harness, "build.schedule", { tasksPath: "design/tasks.json", removedTaskIds: ["T-001"] }, state);
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const testWriterOutcome = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect([published, testWriterOutcome]).toEqual([[], []]);
  });
});
