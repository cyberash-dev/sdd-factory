import { describe, expect, it } from "vitest";
import { assemblyReworkRule } from "../../src/assembly-stage/domain/rules/assembly-rework.js";
import { assemblyStartedRule } from "../../src/assembly-stage/domain/rules/assembly-started.js";
import { assemblyTriagedRule } from "../../src/assembly-stage/domain/rules/assembly-triaged.js";
import { assemblyVerifiedRule } from "../../src/assembly-stage/domain/rules/assembly-verified.js";
import { VERIFICATION_SEQUENCE } from "../../src/assembly-stage/domain/verification-steps.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { delivered, runState, taskState } from "./support.js";

const DEPS = { assemblyRoundsCap: 2, triageHandoffPath: "/run/handoffs/triage/handoff.md" };

function verified(result: string, step: string, failingCovers: readonly string[] = []) {
  return delivered("assembly.verified", { result, step, evidencePath: `/run/handoffs/assembly/round-1/${step}.log`, failingCovers });
}

function assembling(round: number) {
  return runState({
    status: "assembling",
    assemblyRounds: round,
    tasks: {
      "T-001": taskState({ covers: ["todo:BEH-001", "todo:CTR-001"], writes: ["src/cli/**", "tests/cli/**"], implementerAttempts: 1 }),
      "T-002": taskState({ covers: ["todo:BEH-002"], writes: ["src/store/**", "tests/store/**"], implementerAttempts: 2 }),
      "T-003": taskState({ covers: ["todo:BEH-003"], writes: ["src/api/**"], testWriterAttempts: 1 }),
    },
  });
}

describe("assembly.started rule", () => {
  // @covers assembly-stage:BEH-001
  it("moves the run to assembling, counts the round and schedules verification in the given task order", () => {
    const state = runState({ status: "building", assemblyRounds: 1, tasks: { "T-001": taskState({}) } });

    const result = assemblyStartedRule().apply({ state, event: delivered("assembly.started", { taskOrder: ["T-001"] }) });

    expect([result.state.status, result.state.stageAttempts.assemblyRounds, result.emits, result.effects]).toEqual(["assembling", 2, [], [{ kind: "assembly.verify", round: 2, taskOrder: ["T-001"] }]]);
  });

  it("accepts the event only while the run is building", () => {
    expect(assemblyStartedRule().acceptsRunStatus).toEqual(["building"]);
  });
});

describe("assembly.verified rule", () => {
  // @covers assembly-stage:BEH-003
  it("leaves the run untouched on a green intermediate step", () => {
    const state = assembling(1);

    const result = assemblyVerifiedRule(DEPS).apply({ state, event: verified("green", "typecheck") });

    expect(result).toEqual({ state, emits: [], effects: [] });
  });

  // @covers assembly-stage:BEH-008
  // @covers assembly-stage:INV-003
  // @covers assembly-stage:CST-003
  it("hands over to publication only on a green sdd_ready step", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(1), event: verified("green", "sdd_ready") });

    expect([result.state.status, result.effects]).toEqual(["publishing", [{ kind: "assembly.publish" }]]);
  });

  // @covers assembly-stage:BEH-004
  // @covers assembly-stage:OQ-002
  it("routes attributed test failures to every owning implementer exactly once", () => {
    const state = assembling(1);

    const result = assemblyVerifiedRule(DEPS).apply({ state, event: verified("red", "test", ["todo:CTR-001", "todo:BEH-002", "todo:BEH-001"]) });

    expect([result.state.status, result.emits, result.effects]).toEqual([
      "building",
      [
        { type: "assembly.rework", producer: "assembler", payload: { round: 1, taskId: "T-001", target: "implementer" } },
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "implementer", attempt: 2, reason: "assembly_red", findingPath: "/run/handoffs/assembly/round-1/test.log" } },
        { type: "assembly.rework", producer: "assembler", payload: { round: 1, taskId: "T-002", target: "implementer" } },
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-002", target: "implementer", attempt: 3, reason: "assembly_red", findingPath: "/run/handoffs/assembly/round-1/test.log" } },
      ],
      [{ kind: "assembly.record", reworks: [{ round: 1, task_id: "T-001", target: "implementer", source: "attribution" }, { round: 1, task_id: "T-002", target: "implementer", source: "attribution" }] }],
    ]);
  });

  // @covers assembly-stage:BEH-005
  it("sends a test failure with a marker no task covers to triage instead of a lane", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(1), event: verified("red", "test", ["todo:BEH-001", "todo:SUR-001"]) });

    expect([result.emits, result.effects]).toEqual([[], [{ kind: "assembly.triage", round: 1, step: "test", evidencePath: "/run/handoffs/assembly/round-1/test.log" }]]);
  });

  // @covers assembly-stage:BEH-005
  it("sends a failing test file without any marker to triage", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(1), event: verified("red", "test", []) });

    expect(result.effects.map((effect) => effect.kind)).toEqual(["assembly.triage"]);
  });

  // @covers assembly-stage:BEH-005
  it("sends a typecheck failure to triage", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(1), event: verified("red", "typecheck") });

    expect([result.state.status, result.emits, result.effects]).toEqual(["building", [], [{ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath: "/run/handoffs/assembly/round-1/typecheck.log" }]]);
  });

  // @covers assembly-stage:BEH-005
  it("sends an install failure to triage", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(1), event: verified("red", "install") });

    expect(result.effects.map((effect) => effect.kind)).toEqual(["assembly.triage"]);
  });

  // @covers assembly-stage:BEH-006
  it("delegates an sdd ready failure to the ownership router", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(1), event: verified("red", "sdd_ready", ["todo:BEH-001"]) });

    expect(result.effects).toEqual([{ kind: "assembly.route-sdd-ready", round: 1, evidencePath: "/run/handoffs/assembly/round-1/sdd_ready.log" }]);
  });

  // @covers assembly-stage:BEH-007
  // @covers assembly-stage:INV-004
  it("fails the run with cap_exhausted on a red result in the last allowed round and emits no rework", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(2), event: verified("red", "test", ["todo:BEH-001"]) });

    expect([result.state.status, result.state.failure, result.emits, result.effects]).toEqual([
      "failed",
      { stage: "assembly", reason: "cap_exhausted", detail: "round 2" },
      [{ type: "run.failed", producer: "assembler", payload: { stage: "assembly", reason: "cap_exhausted", detail: "round 2" } }],
      [{ kind: "assembly.record", triage: [], failed: "cap_exhausted: round 2" }],
    ]);
  });

  // @covers assembly-stage:BEH-007
  it("still reworks a red result below the cap", () => {
    const result = assemblyVerifiedRule(DEPS).apply({ state: assembling(1), event: verified("red", "test", ["todo:BEH-001"]) });

    expect(result.emits.map((event) => event.type)).toEqual(["assembly.rework", "task.rework"]);
  });

  // @covers assembly-stage:CST-001
  it("caps assembly rounds at two by default", () => {
    expect(DEFAULT_CONFIG.caps.assemblyRounds).toBe(2);
  });

  // @covers assembly-stage:CST-003
  it("keeps sdd ready as the mandatory last step of the verification sequence", () => {
    expect(VERIFICATION_SEQUENCE).toEqual(["install", "typecheck", "test", "sdd_ready"]);
  });
});

describe("assembly.triaged rule", () => {
  // @covers assembly-stage:BEH-005
  it("forwards a lane route as assembly.rework plus task.rework with reason triage and the handoff as finding", () => {
    const state = { ...assembling(1), status: "building" as const };

    const result = assemblyTriagedRule(DEPS).apply({ state, event: delivered("assembly.triaged", { taskId: "T-002", target: "implementer", reason: "compile error in src/store/index.ts" }) });

    expect([result.state.status, result.emits, result.effects]).toEqual([
      "building",
      [
        { type: "assembly.rework", producer: "assembler", payload: { round: 1, taskId: "T-002", target: "implementer" } },
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-002", target: "implementer", attempt: 3, reason: "triage", findingPath: "/run/handoffs/triage/handoff.md" } },
      ],
      [{ kind: "assembly.record", triage: [{ round: 1, task_id: "T-002", target: "implementer", reason: "compile error in src/store/index.ts" }], reworks: [{ round: 1, task_id: "T-002", target: "implementer", source: "triage" }] }],
    ]);
  });

  // @covers assembly-stage:BEH-005
  it("routes a test-writer target with the test-writer attempt counter", () => {
    const result = assemblyTriagedRule(DEPS).apply({ state: assembling(1), event: delivered("assembly.triaged", { taskId: "T-003", target: "test-writer", reason: "orphan marker" }) });

    expect(result.emits[1]?.payload).toEqual({ taskId: "T-003", target: "test-writer", attempt: 2, reason: "triage", findingPath: "/run/handoffs/triage/handoff.md" });
  });

  // @covers assembly-stage:BEH-002
  it("forwards a write-set conflict to the planner with reason write_set_conflict", () => {
    const result = assemblyTriagedRule(DEPS).apply({ state: assembling(1), event: delivered("assembly.triaged", { taskId: "T-003", target: "planner", reason: "write_set_conflict" }) });

    expect(result.emits).toEqual([
      { type: "assembly.rework", producer: "assembler", payload: { round: 1, taskId: "T-003", target: "planner" } },
      { type: "task.rework", producer: "foreman", payload: { taskId: "T-003", target: "planner", attempt: 1, reason: "write_set_conflict", findingPath: null } },
    ]);
  });

  // @covers assembly-stage:BEH-005
  it("fails the run as design_blocked when triage names no task for the planner", () => {
    const result = assemblyTriagedRule(DEPS).apply({ state: assembling(1), event: delivered("assembly.triaged", { taskId: null, target: "planner", reason: "conflict between T-001 and T-002 in src/types.ts" }) });

    expect([result.state.status, result.emits]).toEqual([
      "failed",
      [{ type: "run.failed", producer: "assembler", payload: { stage: "assembly", reason: "design_blocked", detail: "conflict between T-001 and T-002 in src/types.ts" } }],
    ]);
  });

  // @covers assembly-stage:INV-004
  it("fails the run instead of reworking when a conflict route arrives in the last allowed round", () => {
    const result = assemblyTriagedRule(DEPS).apply({ state: assembling(2), event: delivered("assembly.triaged", { taskId: "T-003", target: "planner", reason: "write_set_conflict" }) });

    expect(result.emits.map((event) => [event.type, event.payload["reason"]])).toEqual([["run.failed", "cap_exhausted"]]);
  });
});

describe("assembly.rework rule", () => {
  it("records the rework as the task's last event and emits nothing", () => {
    const state = { ...assembling(1), status: "building" as const };

    const result = assemblyReworkRule().apply({ state, event: delivered("assembly.rework", { round: 1, taskId: "T-001", target: "implementer" }) });

    expect([result.state.tasks["T-001"]?.lastEvent, result.emits, result.effects]).toEqual(["assembly.rework", [], []]);
  });
});
