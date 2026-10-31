import { describe, expect, it } from "vitest";
import { createAssemblySlice } from "../../src/assembly-stage/index.js";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type TransitionResult } from "../../src/bus/domain/transition.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { delivered, runState, sliceContext, taskState } from "./support.js";

const rules = createAssemblySlice()(sliceContext({ root: "/factory", config: { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, assemblyRounds: 3 } } })).rules;

function assembling(round: number): RunState {
  return runState({ status: "assembling", assemblyRounds: round, tasks: { "T-001": taskState({ covers: ["todo:BEH-001"], writes: ["src/cli/**", "tests/cli/**"] }) } });
}

function applied(state: RunState, event: DeliveredEvent<EventType>): TransitionResult {
  const outcome = reduce(rules, state, event, new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

const redTest = delivered("assembly.verified", { result: "red", step: "test", evidencePath: "/run/handoffs/assembly/test.log", failingCovers: ["todo:BEH-001"] });
const triagedToImplementer = delivered("assembly.triaged", { taskId: "T-001", target: "implementer", reason: "type error in src/cli/index.ts" });

describe("assembly round cap of three", () => {
  // @covers factory:DLT-015
  it.each([
    ["assembly.verified", redTest],
    ["assembly.triaged", triagedToImplementer],
  ])("reworks the owning lane instead of failing the run on a red %s in round 2", (_eventType, event) => {
    const state = assembling(2);

    const result = applied(state, event);

    expect(result.emits.map((emitted) => emitted.type)).toEqual(["assembly.rework", "task.rework"]);
  });

  // @covers factory:DLT-015
  it.each([
    ["assembly.verified", redTest],
    ["assembly.triaged", triagedToImplementer],
  ])("fails the run with cap_exhausted and emits no rework on a red %s in round 3", (_eventType, event) => {
    const state = assembling(3);

    const result = applied(state, event);

    expect(result.emits).toEqual([{ type: "run.failed", producer: "assembler", payload: { stage: "assembly", reason: "cap_exhausted", detail: "round 3" } }]);
  });
});
