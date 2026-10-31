import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSEMBLY_EFFECT, createAssemblySlice } from "../../src/assembly-stage/index.js";
import { createReactor } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, TERMINAL_EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { reduce, type TransitionRule } from "../../src/bus/domain/transition.js";
import { createDesignRules } from "../../src/design-stage/domain/rules.js";
import { createDesignStageSlice } from "../../src/design-stage/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { writeTextAtomic } from "../../src/shared/fs/text.js";
import type { ApiRoleRunner } from "../../src/shared/llm/api-role-runner.js";
import { composeEffectRunner, composeRules, type EffectHandler, type Slice } from "../../src/shared/slice.js";
import { describeEvent } from "./scripted-harness.js";
import { delivered, runState, scriptedApiRoles, sddReadyReport, sliceContext, taskState, tempDir } from "./support.js";

type Violation = { readonly kind: string; readonly id?: string; readonly file?: string };

const OWNERLESS_UNCOVERED: readonly Violation[] = [{ kind: "uncovered", id: "todo:SUR-001", file: "spec/spec.md" }];

function approvedTasks(): RunState["tasks"] {
  return {
    "T-001": taskState({ covers: ["todo:BEH-001"], writes: ["src/cli/**", "tests/cli/**"] }),
    "T-002": taskState({ covers: ["todo:BEH-002"], writes: ["src/store/**", "tests/store/**"], dependsOn: ["T-001"] }),
  };
}

function scriptedSddReady(violationsOfRound: (round: number) => readonly Violation[]): EffectHandler {
  return async (effect, context, slice) => {
    const round = Number(effect["round"]);
    const violations = violationsOfRound(round);
    const evidencePath = join(slice.paths.handoffsDir, "assembly", `round-${round}`, "sdd_ready.json");
    await writeTextAtomic(evidencePath, sddReadyReport(violations));
    context.publish({ type: "assembly.verified", producer: "assembler", payload: { result: violations.length === 0 ? "green" : "red", step: "sdd_ready", evidencePath, failingCovers: [] } });
  };
}

const unchangedRecut: EffectHandler = async (_effect, context) => {
  const tasks = Object.entries(context.state.tasks).map(([id, task]) => ({ id, covers: task.covers, writes: task.writes, dependsOn: task.dependsOn }));
  context.publish({ type: "design.tasks.ready", producer: "foreman", payload: { path: "design/tasks.json", taskCount: tasks.length, tasks, changedTaskIds: [] } });
};

const fakePublication: EffectHandler = async (_effect, context) => {
  context.publish({ type: "run.published", producer: "assembler", payload: { commitSha: "a".repeat(40), outputDir: "/team/hidden/todo-cli", pushed: false } });
};

function factoryStub(): Slice {
  const terminal = (eventType: EventType, status: "published" | "failed"): TransitionRule => ({ name: `stub ${eventType}`, eventType, apply: ({ state }) => ({ state: { ...state, status }, emits: [], effects: [] }) });
  return { name: "factory-stub", rules: [terminal("run.published", "published"), terminal("run.failed", "failed")], effects: { "build.schedule": async () => undefined }, participants: () => [] };
}

async function recutRun(input: { readonly sddReady: (round: number) => readonly Violation[]; readonly apiRoles?: ApiRoleRunner }) {
  const root = await tempDir("assembly-recut");
  const context = sliceContext({ root, config: { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, assemblyRounds: 2, plannerRecuts: 1 } }, ...(input.apiRoles === undefined ? {} : { apiRoles: input.apiRoles }) });
  const assembly = createAssemblySlice({ commandRunner: { run: () => Promise.reject(new Error("command not expected")) } })(context);
  const design = createDesignStageSlice()(context);
  const slices = [
    { ...assembly, effects: { ...assembly.effects, [ASSEMBLY_EFFECT.verify]: scriptedSddReady(input.sddReady), [ASSEMBLY_EFFECT.publish]: fakePublication } },
    { ...design, effects: { ...design.effects, "design.plan": unchangedRecut } },
    factoryStub(),
  ];
  const log: string[] = [];
  const engine = new RunEngine({ initialState: runState({ status: "building", tasks: approvedTasks() }), rules: composeRules(slices), store: { write: async () => undefined }, publisher: context.runtime.publisher, effects: composeEffectRunner(slices, context), log: (line) => log.push(line), quiescenceMs: 500 });
  const trace: DeliveredEvent<EventType>[] = [];
  const finished = new Promise<void>((resolve) => {
    const everyType = (handler: (event: DeliveredEvent<EventType>) => void) => Object.fromEntries(EVENT_TYPES.map((type) => [type, handler]));
    context.runtime.join(createReactor("foreman", everyType((event) => void engine.consume(event))));
    context.runtime.join(
      createReactor(
        "tracer",
        everyType((event) => {
          trace.push(event);
          if (TERMINAL_EVENT_TYPES.includes(event.type)) {
            resolve();
          }
        }),
      ),
    );
  });
  context.runtime.publisher.publish({ type: "assembly.started", producer: "assembler", payload: { taskOrder: ["T-001", "T-002"] } });
  await finished;
  return { trace: trace.map(describeEvent), engine };
}

describe("planner re-cut requested from the assembly", () => {
  // @covers assembly-stage:DLT-003
  // @covers assembly-stage:BEH-006
  it("starts round 2 at once when the re-cut for an ownerless uncovered id leaves every task approved", async () => {
    const run = await recutRun({ sddReady: (round) => (round === 1 ? OWNERLESS_UNCOVERED : []) });

    expect([run.trace, run.engine.state.stageAttempts.assemblyRounds]).toEqual([
      [
        "assembly.started",
        "assembly.verified sdd_ready red",
        "design.rework planner uncovered without owner: todo:SUR-001",
        "design.tasks.ready",
        "assembly.started",
        "assembly.verified sdd_ready green",
        "run.published",
      ],
      2,
    ]);
  });

  // @covers assembly-stage:DLT-003
  // @covers assembly-stage:BEH-007
  it("fails the run with cap_exhausted instead of stalling when the round after the re-cut is red at the cap", async () => {
    const run = await recutRun({ sddReady: () => OWNERLESS_UNCOVERED });

    expect(run.trace).toEqual([
      "assembly.started",
      "assembly.verified sdd_ready red",
      "design.rework planner uncovered without owner: todo:SUR-001",
      "design.tasks.ready",
      "assembly.started",
      "assembly.verified sdd_ready red",
      "run.failed assembly cap_exhausted",
    ]);
  });

  // @covers assembly-stage:DLT-003
  // @covers assembly-stage:BEH-005
  it("starts round 2 at once when the triage route to the planner ends in a re-cut that leaves every task approved", async () => {
    const apiRoles = scriptedApiRoles(async () => "---\nrole: triage\nattempt: 1\nstatus: complete\nroute:\n  task_id: null\n  target: planner\n  reason: two tasks export parse\n---\n");

    const run = await recutRun({ sddReady: (round) => (round === 1 ? [{ kind: "aggregated_lint" }] : []), apiRoles });

    expect(run.trace).toEqual([
      "assembly.started",
      "assembly.verified sdd_ready red",
      "assembly.triaged planner two tasks export parse",
      "design.rework planner two tasks export parse",
      "design.tasks.ready",
      "assembly.started",
      "assembly.verified sdd_ready green",
      "run.published",
    ]);
  });
});

describe("design.tasks.ready during assembly rework", () => {
  // @covers assembly-stage:DLT-003
  it("leaves the barrier to the approval of a task the re-cut restarts", () => {
    const rules = createDesignRules({ caps: DEFAULT_CONFIG.caps, worktreesDir: "/run/worktrees" });
    const state = runState({ status: "building", assemblyRounds: 1, plannerRecuts: 1, tasks: approvedTasks() });
    const recut = [
      { id: "T-001", covers: ["todo:BEH-001", "todo:SUR-001"], writes: ["src/cli/**", "tests/cli/**"], dependsOn: [] },
      { id: "T-002", covers: ["todo:BEH-002"], writes: ["src/store/**", "tests/store/**"], dependsOn: ["T-001"] },
    ];

    const outcome = reduce(rules, state, delivered("design.tasks.ready", { path: "design/tasks.json", taskCount: 2, tasks: recut, changedTaskIds: ["T-001"] }), new Set());

    expect(outcome.kind === "applied" ? outcome.result.effects.map((effect) => effect.kind) : outcome.kind).toEqual(["build.schedule"]);
  });
});
