import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntimeObserver } from "../../src/bus/adapters/mozaik/runtime.js";
import type { RunState } from "../../src/bus/domain/run-state.js";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import { aTaskSpec, greeterDesign } from "./support/design.js";
import { aLaneHarness, type LaneHarness } from "./support/harness.js";
import { handoffPathFromWorktree, laneState, provisionLane, RED_TEST } from "./support/lanes.js";
import { aProductRepo, writeProductFile } from "./support/product.js";
import { scriptedCliRoles, writeHandoff } from "./support/runners.js";
import { aTask, buildingState } from "./support/state.js";

interface LaneRosterEntry {
  readonly id: string;
  readonly capabilities: readonly string[];
}

function testWriterRoster(harness: LaneHarness): LaneRosterEntry[] {
  return harness.context.runtime.state
    .getParticipants()
    .filter((participant) => participant.getManifest().name === "test-writer")
    .map((participant) => ({ id: participant.getId(), capabilities: participant.getManifest().capabilities ?? [] }))
    .sort((left, right) => left.capabilities.join(" ").localeCompare(right.capabilities.join(" ")));
}

function sendersOf(harness: LaneHarness, type: string): string[] {
  const senders: string[] = [];
  harness.context.runtime.join(createRuntimeObserver("probe", (event) => (event.type === type ? senders.push(event.producerId) : undefined)));
  return senders;
}

async function runTestWriterThroughRuntime(harness: LaneHarness, taskId: string, state: RunState): Promise<void> {
  const handler = harness.slice.effects["build.test-writer"];
  if (handler === undefined) {
    throw new Error("build.test-writer handler missing");
  }
  const publish = (pending: PendingEvent): void => {
    harness.context.runtime.publisher.publish(pending);
  };
  await handler({ kind: "build.test-writer", taskId, attempt: 1, reworkFinding: null }, { state, publish }, harness.context);
}

async function cancelAllLanes(harness: LaneHarness | null, state: RunState | null): Promise<void> {
  if (harness === null || state === null) {
    return;
  }
  await harness.slice.effects["build.terminate-lanes"]?.({ kind: "build.terminate-lanes" }, { state, publish: () => undefined }, harness.context);
}

async function writeCompleteHandoff(worktree: string): Promise<void> {
  await writeProductFile(worktree, "tests/greet.test.ts", RED_TEST);
  await writeHandoff(handoffPathFromWorktree(worktree, "test-writer", 1, basename(worktree)), { role: "test-writer", attempt: 1, status: "complete", test_files: ["tests/greet.test.ts"], covers: ["greeter:BEH-001"], blocked_reason: "" });
}

function arrivalBarrier(expected: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const everyoneArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    (arrived === expected ? release : () => undefined)();
    return everyoneArrived;
  };
}

describe("lane participants", () => {
  // @covers build-stage:BEH-017
  it("joins a test-writer participant for the task while the subprocess runs, sends its event from it and leaves afterwards", async () => {
    const rosterDuringRun: LaneRosterEntry[][] = [];
    let harnessRef: LaneHarness | null = null;
    const cliRoles = scriptedCliRoles(async (request) => {
      rosterDuringRun.push(harnessRef === null ? [] : testWriterRoster(harnessRef));
      await writeCompleteHandoff(request.cwd);
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    harnessRef = harness;
    const senders = sendersOf(harness, "task.tests_written");
    const lane = await provisionLane(harness);

    await runTestWriterThroughRuntime(harness, "T-001", laneState(lane));

    expect([rosterDuringRun.map((roster) => roster.map((entry) => entry.capabilities)), testWriterRoster(harness), senders]).toEqual([[[["lane", "task:T-001"]]], [], [rosterDuringRun[0]?.[0]?.id]]);
  });

  it("leaves the lane participant without publishing when the lane is cancelled while the subprocess runs", async () => {
    const rosterDuringRun: string[][] = [];
    let harnessRef: LaneHarness | null = null;
    let stateRef: RunState | null = null;
    const cliRoles = scriptedCliRoles(async (request) => {
      rosterDuringRun.push(harnessRef === null ? [] : testWriterRoster(harnessRef).map((entry) => entry.capabilities.join(" ")));
      await cancelAllLanes(harnessRef, stateRef);
      await writeCompleteHandoff(request.cwd);
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    harnessRef = harness;
    const senders = sendersOf(harness, "task.tests_written");
    const lane = await provisionLane(harness);
    const state = laneState(lane);
    stateRef = state;

    await runTestWriterThroughRuntime(harness, "T-001", state);

    expect([rosterDuringRun, testWriterRoster(harness), senders]).toEqual([[["lane task:T-001"]], [], []]);
  });

  it("represents two concurrently running lanes as two simultaneously joined participants", async () => {
    const arrive = arrivalBarrier(2);
    const rosterAtOverlap: string[][] = [];
    let harnessRef: LaneHarness | null = null;
    const cliRoles = scriptedCliRoles(async (request) => {
      await arrive();
      rosterAtOverlap.push(harnessRef === null ? [] : testWriterRoster(harnessRef).map((entry) => entry.capabilities.join(" ")));
      await writeCompleteHandoff(request.cwd);
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign([aTaskSpec({ id: "T-001" }), aTaskSpec({ id: "T-002" })]), cliRoles });
    harnessRef = harness;
    const first = await provisionLane(harness, "T-001");
    const second = await provisionLane(harness, "T-002");
    const state = buildingState({
      "T-001": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 1 }, worktree: first.worktree, baseSha: first.baseSha }),
      "T-002": aTask({ status: "tests_pending", attempts: { implementer: 0, testWriter: 1 }, worktree: second.worktree, baseSha: second.baseSha }),
    });

    await Promise.all([runTestWriterThroughRuntime(harness, "T-001", state), runTestWriterThroughRuntime(harness, "T-002", state)]);

    expect([rosterAtOverlap[0], rosterAtOverlap[1], testWriterRoster(harness)]).toEqual([["lane task:T-001", "lane task:T-002"], ["lane task:T-001", "lane task:T-002"], []]);
  });
});
