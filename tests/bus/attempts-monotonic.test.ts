import { describe, expect, it } from "vitest";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { EventPayload } from "../../src/bus/domain/envelope.js";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { dedupeKey, reduce } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { aTask, BASE_SHA, buildingState, delivered, IMPL_SHA, TESTS_SHA } from "../build-stage/support/state.js";

const rules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });

const cost = { attempt: 1, handoffPath: "/run/handoffs/h.md", costUsd: null, inputTokens: 1, outputTokens: 1, durationMs: 1 };

const laneWithRework: readonly (readonly [EventType, EventPayload])[] = [
  ["task.ready", { taskId: "T-001", worktree: "/run/worktrees/T-001", baseSha: BASE_SHA, covers: ["greeter:BEH-001"], writes: ["src/greet.ts", "tests/greet.test.ts"] }],
  ["task.tests_written", { taskId: "T-001", ...cost }],
  ["task.tests_rejected", { taskId: "T-001", reason: "vacuous", detail: "passes at base" }],
  ["task.tests_written", { taskId: "T-001", ...cost, attempt: 2 }],
  ["task.tests_red", { taskId: "T-001", testsSha: TESTS_SHA, testFiles: ["tests/greet.test.ts"] }],
  ["task.impl_done", { taskId: "T-001", ...cost }],
  ["task.verified", { taskId: "T-001", result: "red", evidencePath: "/run/handoffs/tasks/T-001/verifier-green-1.json", testsUnchanged: true, writeSetOk: true, implSha: null }],
  ["task.rework", { taskId: "T-001", target: "implementer", attempt: 2, reason: "red", findingPath: null }],
  ["task.impl_done", { taskId: "T-001", ...cost, attempt: 2 }],
  ["task.verified", { taskId: "T-001", result: "red", evidencePath: "/run/handoffs/tasks/T-001/verifier-green-2.json", testsUnchanged: true, writeSetOk: true, implSha: null }],
  ["task.rework", { taskId: "T-001", target: "implementer", attempt: 3, reason: "red", findingPath: null }],
  ["task.impl_done", { taskId: "T-001", ...cost, attempt: 3 }],
  ["task.verified", { taskId: "T-001", result: "green", evidencePath: "/run/handoffs/tasks/T-001/verifier-green-3.json", testsUnchanged: true, writeSetOk: true, implSha: IMPL_SHA }],
];

function snapshots(sequence: readonly (readonly [EventType, EventPayload])[]): readonly RunState[] {
  const consumed = new Set<string>();
  let state = buildingState({ "T-001": aTask({ worktree: "" }) });
  const out: RunState[] = [state];
  sequence.forEach(([type, payload], index) => {
    const event = delivered(type, payload, index + 1);
    const outcome = reduce(rules, state, event, consumed);
    if (outcome.kind === "applied") {
      state = outcome.result.state;
      out.push(state);
      const key = dedupeKey(event);
      if (key !== null) {
        consumed.add(key);
      }
    }
  });
  return out;
}

function isNonDecreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value >= (values[index - 1] ?? 0));
}

describe("attempt counters over a lane with a test-writer restart and two implementer reworks", () => {
  // @covers bus:INV-002
  it("never decreases any attempt counter across the persisted snapshots", () => {
    const states = snapshots(laneWithRework);

    const implementer = states.map((state) => state.tasks["T-001"]?.attempts.implementer ?? 0);
    const testWriter = states.map((state) => state.tasks["T-001"]?.attempts.testWriter ?? 0);
    expect([states.length > 10, isNonDecreasing(implementer), isNonDecreasing(testWriter), implementer.at(-1), testWriter.at(-1)]).toEqual([true, true, true, 3, 2]);
  });

  it("keeps the test-writer counter at its value after the lane restart instead of resetting it", () => {
    const states = snapshots(laneWithRework.slice(0, 4));

    expect(states.map((state) => state.tasks["T-001"]?.attempts.testWriter ?? 0)).toEqual([0, 1, 1, 2, 2]);
  });
});
