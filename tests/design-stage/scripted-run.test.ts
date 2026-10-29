import { describe, expect, it } from "vitest";
import { createReactor } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import type { TransitionRule } from "../../src/bus/domain/transition.js";
import { createDesignStageSlice } from "../../src/design-stage/index.js";
import { composeEffectRunner, composeRules, type Slice } from "../../src/shared/slice.js";
import { ARCHITECT_HANDOFF_LINES, handoffText, harness, PLANNER_HANDOFF_LINES, readVia, stateIn, tasksJsonText, techMdText, VALID_TASKS, VERIFICATION_HANDOFF_LINES, verificationMdText, writeVia, type Harness, type RoleScript, type TaskInput } from "./harness.js";

const HANDOFFS = ".factory/runs/todo-cli-20261029-120000/handoffs";

const specApprovedStandIn: TransitionRule = {
  name: "spec.approved -> designing (spec-stage stand-in)",
  eventType: "spec.approved",
  acceptsRunStatus: ["spec_approved"],
  apply: ({ state }) => ({ state: { ...state, status: "designing" }, emits: [], effects: [{ kind: "design.architect", attempt: 1 }, { kind: "design.verification", attempt: 1 }] }),
};

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function architect(journal: string[]): RoleScript {
  return async (request) => {
    journal.push("started:architect");
    await yieldTurn();
    await readVia(request, "spec/spec.md");
    await writeVia(request, "design/tech.md", techMdText());
    await writeVia(request, `${HANDOFFS}/architect/handoff.md`, handoffText("architect", 1, ARCHITECT_HANDOFF_LINES));
  };
}

function verificationDesigner(journal: string[]): RoleScript {
  return async (request) => {
    journal.push("started:verification-designer");
    await yieldTurn();
    await writeVia(request, "design/verification.md", verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]));
    await writeVia(request, `${HANDOFFS}/verification-designer/handoff.md`, handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
  };
}

function planner(journal: string[], tasks: readonly TaskInput[]): RoleScript {
  return async (request) => {
    journal.push("started:planner");
    await yieldTurn();
    await writeVia(request, "design/tasks.json", tasksJsonText(tasks));
    await writeVia(request, `${HANDOFFS}/planner/handoff.md`, handoffText("planner", 1, PLANNER_HANDOFF_LINES));
  };
}

interface ScriptedRun {
  readonly journal: string[];
  readonly engine: RunEngine;
  readonly scheduled: string[];
  readonly failedDetail: string | null;
}

async function scriptedDesignStage(h: Harness, journal: string[]): Promise<ScriptedRun> {
  const scheduled: string[] = [];
  let failedDetail: string | null = null;
  const designSlice = createDesignStageSlice({ commands: h.commandRunner })(h.slice);
  const buildStub: Slice = { name: "build-stub", rules: [], effects: { "build.schedule": async (effect) => { scheduled.push(String(effect["tasksPath"])); } }, participants: () => [] };
  const settled: Promise<unknown>[] = [];
  const engine = new RunEngine({
    initialState: stateIn("spec_approved"),
    rules: composeRules([{ name: "spec-stub", rules: [specApprovedStandIn], effects: {}, participants: () => [] }, designSlice]),
    store: { write: async () => undefined },
    publisher: h.slice.runtime.publisher,
    effects: composeEffectRunner([designSlice, buildStub], h.slice),
    log: () => undefined,
  });
  const everyType = Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => settled.push(engine.consume(event))]));
  h.slice.runtime.join(createReactor("foreman", everyType));
  h.slice.runtime.join(createReactor("tracer", Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => journal.push(event.type)]))));
  h.slice.runtime.join(createReactor("assembler", { "run.failed": (event) => { failedDetail = String(event.payload["detail"]); } }));
  h.slice.runtime.publisher.publish({ type: "spec.approved", producer: "foreman", payload: { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 3 } });
  for (let round = 0; round < 400 && !journal.includes("design.tasks.ready") && !journal.includes("run.failed"); round += 1) {
    await Promise.all(settled.splice(0));
    await yieldTurn();
  }
  return { journal, engine, scheduled, failedDetail };
}

describe("design stage through the run engine", () => {
  // @covers design-stage:BEH-001
  // @covers design-stage:BEH-002
  it("starts both design roles in the spec.approved dispatch, then exactly one planner at the barrier, and ends in building with the tasks", async () => {
    const journal: string[] = [];
    const h = await harness({ scripts: { architect: [architect(journal)], "verification-designer": [verificationDesigner(journal)], planner: [planner(journal, VALID_TASKS)] } });

    const run = await scriptedDesignStage(h, journal);

    const firstReady = journal.findIndex((entry) => entry.startsWith("design.") && entry.endsWith(".ready"));
    expect([
      journal[0],
      [...journal.slice(1, 3)].sort(),
      firstReady > journal.indexOf("started:verification-designer") && firstReady > journal.indexOf("started:architect"),
      journal.filter((entry) => entry === "started:planner").length,
      journal[journal.length - 1],
      run.engine.state.status,
      Object.keys(run.engine.state.tasks),
      run.scheduled,
    ]).toEqual(["spec.approved", ["started:architect", "started:verification-designer"], true, 1, "design.tasks.ready", "building", ["T-001", "T-002"], ["design/tasks.json"]]);
  });

  // @covers design-stage:BEH-002
  it("re-runs the planner once on overlapping writes and accepts the valid second output", async () => {
    const journal: string[] = [];
    const overlapping = [{ id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-002"], writes: ["src/**", "tests/cli/**"] }, { id: "T-002", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], designRefs: ["M-02"] }];
    const h = await harness({ scripts: { architect: [architect(journal)], "verification-designer": [verificationDesigner(journal)], planner: [planner(journal, overlapping), planner(journal, VALID_TASKS)] } });

    const run = await scriptedDesignStage(h, journal);

    expect([journal.filter((entry) => entry === "design.rework").length, journal.filter((entry) => entry === "started:planner").length, journal[journal.length - 1], run.engine.state.stageAttempts.plannerRecuts]).toEqual([1, 2, "design.tasks.ready", 1]);
  });

  // @covers design-stage:CST-001
  it("blocks the design with planner_cap on the second invalid output and fails the run", async () => {
    const journal: string[] = [];
    const overlapping = [{ id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-002"], writes: ["src/**", "tests/cli/**"] }, { id: "T-002", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], designRefs: ["M-02"] }];
    const h = await harness({ scripts: { architect: [architect(journal)], "verification-designer": [verificationDesigner(journal)], planner: [planner(journal, overlapping), planner(journal, overlapping), planner(journal, VALID_TASKS)] } });

    const run = await scriptedDesignStage(h, journal);

    expect([journal.filter((entry) => entry === "started:planner").length, journal.slice(-3), run.failedDetail]).toEqual([2, ["design.rework", "design.blocked", "run.failed"], "planner_cap"]);
  });

  // @covers design-stage:BEH-001
  it("fails the run when one role is blocked while the other is left to finish", async () => {
    const journal: string[] = [];
    const blockedArchitect: RoleScript = async (request) => {
      journal.push("started:architect");
      await yieldTurn();
      await writeVia(request, `${HANDOFFS}/architect/handoff.md`, handoffText("architect", 1, ["status: blocked", "modules: []", "tooling: {}", "blocked_reason: no approved record"]));
    };
    const h = await harness({ scripts: { architect: [blockedArchitect], "verification-designer": [verificationDesigner(journal)], planner: [] } });

    const run = await scriptedDesignStage(h, journal);

    expect([journal.includes("started:verification-designer"), journal.includes("started:planner"), run.failedDetail, run.engine.state.status]).toEqual([true, false, "no approved record", "designing"]);
  });
});

