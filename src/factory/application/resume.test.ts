import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent, Producer } from "../../bus/domain/envelope.js";
import { createRunState, createTaskState, type RunState, type TaskState } from "../../bus/domain/run-state.js";
import { reduce, type TransitionRule } from "../../bus/domain/transition.js";
import { planReplay, readResumeSource, ResumeError } from "./resume.js";

const RULES: readonly TransitionRule[] = [
  { name: "started", eventType: "run.started", apply: ({ state }) => ({ state: { ...state, status: "workspace" }, emits: [], effects: [{ kind: "factory.bootstrap" }] }) },
  { name: "intervention", eventType: "human.intervention", apply: ({ state }) => ({ state, emits: [], effects: [] }) },
  { name: "workspace", eventType: "workspace.ready", apply: ({ state }) => ({ state: { ...state, status: "spec_drafting" }, emits: [], effects: [{ kind: "spec.draft" }] }) },
  { name: "drafted", eventType: "spec.drafted", apply: ({ state }) => ({ state: { ...state, status: "spec_review" }, emits: [], effects: [{ kind: "spec.review" }] }) },
  { name: "failed", eventType: "run.failed", apply: ({ state }) => ({ state: { ...state, status: "failed" }, emits: [], effects: [{ kind: "factory.finalize" }] }) },
];

function delivered(seq: number, type: EventType, producer: Producer, payload: Record<string, unknown> = {}): DeliveredEvent<EventType> {
  return { type, runId: "todo-cli-20261030-160028", occurredAt: `2026-10-30T16:0${seq}:00.000Z`, producer, seq, payload };
}

function initial(): ReturnType<typeof createRunState> {
  return createRunState({ runId: "todo-cli-20261030-160028", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-30T16:00:00.000Z" });
}

async function runDirWith(manifest: Record<string, unknown>, traceLines: readonly string[] | null): Promise<{ repoRoot: string; runId: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));
  const runId = "todo-cli-20261030-160028";
  const runDir = join(repoRoot, ".factory", "runs", runId);
  await mkdir(join(runDir, "trace"), { recursive: true });
  await writeFile(join(runDir, "run.json"), JSON.stringify({ runId, slug: "todo-cli", specPath: "specs/todo-cli.md", operator: "cyberash", startedAt: "2026-10-30T16:00:00.000Z", ...manifest }));
  if (traceLines !== null) {
    await writeFile(join(runDir, "trace", "trace.jsonl"), `${traceLines.join("\n")}\n`);
  }
  return { repoRoot, runId };
}

describe("resume replay plan", () => {
  // @covers factory:BEH-009
  it("seeds the state before the last effectful event and names that event as the redo", () => {
    const events = [delivered(1, "run.started", "foreman"), delivered(2, "human.intervention", "foreman", { kind: "launch" }), delivered(3, "workspace.ready", "foreman"), delivered(4, "spec.drafted", "spec-analyst"), delivered(5, "run.failed", "foreman")];

    const plan = planReplay(RULES, initial(), events);

    expect([plan.state.status, plan.redo.map((event) => [event.type, event.seq, event.producer])]).toEqual(["spec_drafting", [["spec.drafted", 4, "spec-analyst"]]]);
  });

  // @covers factory:BEH-009
  it("stops replaying at the terminal event so a later event after run.failed is never the redo", () => {
    const events = [delivered(1, "run.started", "foreman"), delivered(2, "workspace.ready", "foreman"), delivered(3, "run.failed", "foreman"), delivered(4, "spec.drafted", "spec-analyst")];

    const plan = planReplay(RULES, initial(), events);

    expect([plan.state.status, plan.redo.map((event) => event.type)]).toEqual(["workspace", ["workspace.ready"]]);
  });

  // @covers factory:BEH-009
  it("rejects a trace in which no event produced an effect", () => {
    const events = [delivered(1, "human.intervention", "foreman", { kind: "launch" }), delivered(2, "run.failed", "foreman")];

    expect(() => planReplay(RULES, initial(), events)).toThrow(new ResumeError("nothing to resume: no replayed event produced an effect"));
  });
});

function taskIdOf(payload: Readonly<Record<string, unknown>>): string {
  return typeof payload["taskId"] === "string" ? payload["taskId"] : "";
}

function withTaskChange(state: RunState, taskId: string, change: (task: TaskState) => TaskState): RunState {
  const task = state.tasks[taskId];
  return task === undefined ? state : { ...state, tasks: { ...state.tasks, [taskId]: change(task) } };
}

const TASK_RULES: readonly TransitionRule[] = [
  {
    name: "ready",
    eventType: "task.ready",
    acceptsTaskStatus: ["ready"],
    apply: ({ state, event }) => ({ state: withTaskChange(state, taskIdOf(event.payload), (task) => ({ ...task, status: "tests_pending", attempts: { implementer: 0, testWriter: 1 } })), emits: [], effects: [{ kind: "build.test-writer" }] }),
  },
  {
    name: "rejected",
    eventType: "task.tests_rejected",
    acceptsTaskStatus: ["tests_pending"],
    apply: ({ state, event }) => ({ state: withTaskChange(state, taskIdOf(event.payload), (task) => ({ ...task, attempts: { implementer: 0, testWriter: task.attempts.testWriter + 1 } })), emits: [], effects: [{ kind: "build.restart-lane" }] }),
  },
  {
    name: "approved",
    eventType: "task.approved",
    acceptsTaskStatus: ["tests_pending"],
    apply: ({ state, event }) => ({ state: withTaskChange(state, taskIdOf(event.payload), (task) => ({ ...task, status: "approved" })), emits: [], effects: [{ kind: "build.schedule" }] }),
  },
  { name: "spec approved", eventType: "spec.approved", apply: ({ state }) => ({ state: { ...state, status: "designing" }, emits: [], effects: [{ kind: "design.start" }] }) },
];

function buildingWith(taskIds: readonly string[]): RunState {
  const tasks = Object.fromEntries(taskIds.map((taskId) => [taskId, createTaskState({ worktree: `worktrees/${taskId}`, covers: [], writes: [], dependsOn: [] })]));
  return { ...initial(), status: "building", tasks };
}

function taskSummary(state: RunState, taskId: string): readonly [string | undefined, number | undefined] {
  const task = state.tasks[taskId];
  return [task?.status, task?.attempts.testWriter];
}

describe("multi-lane resume replay plan", () => {
  const twoLanesInFlight = [
    delivered(1, "task.ready", "foreman", { taskId: "T-001" }),
    delivered(2, "task.approved", "foreman", { taskId: "T-001" }),
    delivered(3, "task.ready", "foreman", { taskId: "T-002" }),
    delivered(4, "task.ready", "foreman", { taskId: "T-003" }),
    delivered(5, "task.tests_rejected", "foreman", { taskId: "T-003" }),
    delivered(6, "run.failed", "foreman"),
  ];

  // @covers factory:DLT-006
  it("redoes the lane entry of every other in-flight task and then the latest effectful event, in seq order", () => {
    const plan = planReplay(TASK_RULES, buildingWith(["T-001", "T-002", "T-003"]), twoLanesInFlight);

    expect(plan.redo.map((event) => [event.type, taskIdOf(event.payload), event.seq])).toEqual([
      ["task.ready", "T-002", 3],
      ["task.tests_rejected", "T-003", 5],
    ]);
  });

  // @covers factory:DLT-006
  it("rolls each other in-flight task back to its state before its lane entry and leaves approved tasks alone", () => {
    const plan = planReplay(TASK_RULES, buildingWith(["T-001", "T-002", "T-003"]), twoLanesInFlight);

    expect([taskSummary(plan.state, "T-001"), taskSummary(plan.state, "T-002"), taskSummary(plan.state, "T-003"), plan.state.status]).toEqual([
      ["approved", 1],
      ["ready", 0],
      ["tests_pending", 1],
      "building",
    ]);
  });

  // @covers factory:DLT-006
  it("redoes the latest event once when its task is the only one in flight", () => {
    const events = [delivered(1, "task.ready", "foreman", { taskId: "T-001" }), delivered(2, "task.tests_rejected", "foreman", { taskId: "T-001" }), delivered(3, "run.failed", "foreman")];

    const plan = planReplay(TASK_RULES, buildingWith(["T-001"]), events);

    expect([plan.redo.map((event) => [event.type, event.seq]), taskSummary(plan.state, "T-001")]).toEqual([[["task.tests_rejected", 2]], ["tests_pending", 1]]);
  });

  // @covers factory:DLT-006
  it("redoes a single event when no lane is in flight", () => {
    const events = [delivered(1, "spec.approved", "foreman"), delivered(2, "run.failed", "foreman")];

    const plan = planReplay(TASK_RULES, initial(), events);

    expect(plan.redo.map((event) => [event.type, event.seq])).toEqual([["spec.approved", 1]]);
  });
});

const FAILURE_CHAIN_RULES: readonly TransitionRule[] = [
  ...TASK_RULES,
  {
    name: "impl done",
    eventType: "task.impl_done",
    acceptsTaskStatus: ["tests_pending"],
    apply: ({ state, event }) => ({ state: withTaskChange(state, taskIdOf(event.payload), (task) => ({ ...task, status: "verify_pending", attempts: { ...task.attempts, implementer: 1 } })), emits: [], effects: [{ kind: "build.verify" }] }),
  },
  {
    name: "verified",
    eventType: "task.verified",
    acceptsTaskStatus: ["verify_pending"],
    apply: ({ state, event }) => ({ state: withTaskChange(state, taskIdOf(event.payload), (task) => ({ ...task, status: "review_pending", implSha: typeof event.payload["implSha"] === "string" ? event.payload["implSha"] : null })), emits: [], effects: [{ kind: "build.reviewer" }] }),
  },
  {
    name: "task failed",
    eventType: "task.failed",
    acceptsTaskStatus: ["tests_pending", "review_pending"],
    apply: ({ state, event }) => ({ state: withTaskChange(state, taskIdOf(event.payload), (task) => ({ ...task, status: "failed" })), emits: [], effects: [{ kind: "build.terminate-lanes" }] }),
  },
  { name: "drafted", eventType: "spec.drafted", apply: ({ state }) => ({ state: { ...state, status: "spec_review" }, emits: [], effects: [{ kind: "spec.review" }] }) },
  { name: "spec blocked", eventType: "spec.blocked", apply: ({ state }) => ({ state, emits: [], effects: [{ kind: "factory.finalize" }] }) },
];

describe("failure chain cut", () => {
  const reviewerDropped = [
    delivered(1, "task.ready", "foreman", { taskId: "T-007" }),
    delivered(2, "task.impl_done", "implementer", { taskId: "T-007", attempt: 1 }),
    delivered(3, "task.verified", "foreman", { taskId: "T-007", result: "green", implSha: "ef".repeat(20) }),
    delivered(4, "task.failed", "foreman", { taskId: "T-007", reason: "unparseable_handoff", detail: "reviewer" }),
    delivered(5, "run.failed", "foreman"),
  ];

  // @covers factory:DLT-007
  it("redoes the failed task's lane entry instead of task.failed", () => {
    const plan = planReplay(FAILURE_CHAIN_RULES, buildingWith(["T-007"]), reviewerDropped);

    expect(plan.redo.map((event) => [event.type, taskIdOf(event.payload), event.seq])).toEqual([["task.verified", "T-007", 3]]);
  });

  // @covers factory:DLT-008
  it("seeds the failed task at its state before its lane entry", () => {
    const plan = planReplay(FAILURE_CHAIN_RULES, buildingWith(["T-007"]), reviewerDropped);

    const task = plan.state.tasks["T-007"];
    expect([task?.status, task?.implSha, task?.attempts.implementer]).toEqual(["verify_pending", null, 1]);
  });

  // @covers factory:DLT-008
  it("applies the republished lane entry of the failed task to the seeded state", () => {
    const plan = planReplay(FAILURE_CHAIN_RULES, buildingWith(["T-007"]), reviewerDropped);

    const outcomes = plan.redo.map((event) => reduce(FAILURE_CHAIN_RULES, plan.state, event, new Set()).kind);
    expect(outcomes).toEqual(["applied"]);
  });

  // @covers factory:DLT-007
  it("redoes the event before spec.blocked and never spec.blocked itself", () => {
    const events = [delivered(1, "spec.drafted", "spec-analyst"), delivered(2, "spec.blocked", "foreman", { reason: "lint_cap", detail: "3 cycles" }), delivered(3, "run.failed", "foreman")];

    const plan = planReplay(FAILURE_CHAIN_RULES, { ...initial(), status: "spec_drafting" }, events);

    expect(plan.redo.map((event) => [event.type, event.seq])).toEqual([["spec.drafted", 1]]);
  });

  // @covers factory:DLT-007
  it("rejects a trace of run.started and run.failed only", () => {
    const events = [delivered(1, "run.started", "foreman"), delivered(2, "run.failed", "foreman")];

    expect(() => planReplay(RULES, initial(), events)).toThrow(new ResumeError("nothing to resume: no replayed event produced an effect"));
  });

  // @covers factory:DLT-008
  it("never redoes run.started even though its transition carries the bootstrap effect", () => {
    const events = [delivered(1, "run.started", "foreman"), delivered(2, "human.intervention", "foreman", { kind: "launch" }), delivered(3, "run.failed", "foreman")];

    expect(() => planReplay(RULES, initial(), events)).toThrow(new ResumeError("nothing to resume: no replayed event produced an effect"));
  });
});

describe("resume source", () => {
  // @covers factory:BEH-009
  it("reads the failed run's manifest and its bus events, skipping runtime records", async () => {
    const { repoRoot, runId } = await runDirWith({ status: "failed" }, [
      JSON.stringify({ type: "run.started", runId: "todo-cli-20261030-160028", occurredAt: "2026-10-30T16:00:01.000Z", producer: "foreman", seq: 1, payload: { slug: "todo-cli" } }),
      JSON.stringify({ type: "inference.started", runId: "todo-cli-20261030-160028", occurredAt: "2026-10-30T16:00:02.000Z", producer: "runtime", seq: 2, payload: {} }),
      JSON.stringify({ type: "workspace.ready", runId: "todo-cli-20261030-160028", occurredAt: "2026-10-30T16:00:03.000Z", producer: "foreman", seq: 3, payload: {} }),
    ]);

    const source = await readResumeSource(repoRoot, runId, false);

    expect([source.manifest.specPath, source.events.map((event) => [event.type, event.seq])]).toEqual(["specs/todo-cli.md", [["run.started", 1], ["workspace.ready", 3]]]);
  });

  // @covers factory:BEH-009
  it("refuses a run still marked running unless --force vouches that its process is gone", async () => {
    const { repoRoot, runId } = await runDirWith({ status: "running" }, []);

    await expect(readResumeSource(repoRoot, runId, false)).rejects.toThrow(new ResumeError(`run ${runId} is still marked running; pass --force when its process is gone`));
    await expect(readResumeSource(repoRoot, runId, true)).resolves.toMatchObject({ events: [] });
  });

  // @covers factory:BEH-009
  it.each([
    ["published", "is published; nothing to resume"],
    ["failed", "has no trace/trace.jsonl under"],
  ])("rejects a %s run as %s", async (status, fragment) => {
    const { repoRoot, runId } = await runDirWith({ status }, status === "failed" ? null : []);

    await expect(readResumeSource(repoRoot, runId, false)).rejects.toThrow(fragment);
  });

  // @covers factory:BEH-009
  it("rejects a run id that has no run directory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));

    await expect(readResumeSource(repoRoot, "todo-cli-20261030-000000", false)).rejects.toThrow("has no run.json under");
  });
});

const ANCESTOR_RUN_ID = "todo-cli-20261030-150000";
const RESUMED_RUN_ID = "todo-cli-20261030-160028";

function traceLine(runId: string, seq: number, type: EventType, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, runId, occurredAt: `2026-10-30T16:0${seq}:00.000Z`, producer: "foreman", seq, payload });
}

async function chainRunDir(repoRoot: string, runId: string, resumedFrom: string | null, traceLines: readonly string[] | null): Promise<string> {
  const runDir = join(repoRoot, ".factory", "runs", runId);
  await mkdir(join(runDir, "trace"), { recursive: true });
  await writeFile(join(runDir, "run.json"), JSON.stringify({ runId, slug: "todo-cli", specPath: "specs/todo-cli.md", operator: "cyberash", startedAt: "2026-10-30T16:00:00.000Z", status: "failed", resumedFrom }));
  if (traceLines !== null) {
    await writeFile(join(runDir, "trace", "trace.jsonl"), `${traceLines.join("\n")}\n`);
  }
  return runDir;
}

describe("resume source of a resumed run", () => {
  // @covers factory:DLT-009
  it("prefixes the run's own events with the ancestor's events cut at the ancestor's failure chain", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));
    await chainRunDir(repoRoot, ANCESTOR_RUN_ID, null, [
      traceLine(ANCESTOR_RUN_ID, 1, "run.started"),
      traceLine(ANCESTOR_RUN_ID, 2, "workspace.ready"),
      traceLine(ANCESTOR_RUN_ID, 3, "run.failed"),
    ]);
    await chainRunDir(repoRoot, RESUMED_RUN_ID, ANCESTOR_RUN_ID, [
      traceLine(RESUMED_RUN_ID, 1, "run.started"),
      traceLine(RESUMED_RUN_ID, 2, "human.intervention", { kind: "fix_between_runs" }),
      traceLine(RESUMED_RUN_ID, 3, "workspace.ready"),
      traceLine(RESUMED_RUN_ID, 4, "run.failed"),
    ]);

    const source = await readResumeSource(repoRoot, RESUMED_RUN_ID, false);

    expect(source.events.map((event) => [event.runId, event.type, event.seq])).toEqual([
      [ANCESTOR_RUN_ID, "run.started", 1],
      [ANCESTOR_RUN_ID, "workspace.ready", 2],
      [RESUMED_RUN_ID, "run.started", 1],
      [RESUMED_RUN_ID, "human.intervention", 2],
      [RESUMED_RUN_ID, "workspace.ready", 3],
      [RESUMED_RUN_ID, "run.failed", 4],
    ]);
  });

  // @covers factory:DLT-009
  it("names every run of the chain, first run first, and keeps the first run's directory as the work directory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));
    const ancestorDir = await chainRunDir(repoRoot, ANCESTOR_RUN_ID, null, [traceLine(ANCESTOR_RUN_ID, 1, "run.started")]);
    await chainRunDir(repoRoot, RESUMED_RUN_ID, ANCESTOR_RUN_ID, [traceLine(RESUMED_RUN_ID, 1, "run.started")]);

    const source = await readResumeSource(repoRoot, RESUMED_RUN_ID, false);

    expect([source.chain, source.workDir]).toEqual([[ANCESTOR_RUN_ID, RESUMED_RUN_ID], ancestorDir]);
  });

  // @covers factory:DLT-009
  it.each([
    ["directory", false],
    ["trace", true],
  ])("rejects a resumed run whose ancestor %s is missing, naming the ancestor", async (_missing, hasAncestorDir) => {
    const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));
    if (hasAncestorDir) {
      await chainRunDir(repoRoot, ANCESTOR_RUN_ID, null, null);
    }
    await chainRunDir(repoRoot, RESUMED_RUN_ID, ANCESTOR_RUN_ID, [traceLine(RESUMED_RUN_ID, 1, "run.started")]);

    await expect(readResumeSource(repoRoot, RESUMED_RUN_ID, false)).rejects.toThrow(new RegExp(`^ancestor run ${ANCESTOR_RUN_ID} of ${RESUMED_RUN_ID} has no `));
  });

  // @covers factory:DLT-009
  it("keeps a run that was not resumed as a chain of itself working in its own directory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));
    const runDir = await chainRunDir(repoRoot, RESUMED_RUN_ID, null, [traceLine(RESUMED_RUN_ID, 1, "run.started")]);

    const source = await readResumeSource(repoRoot, RESUMED_RUN_ID, false);

    expect([source.chain, source.workDir]).toEqual([[RESUMED_RUN_ID], runDir]);
  });
});

describe("resume replay plan over a chain of runs", () => {
  // @covers factory:DLT-009
  it("orders redo events by their place in the chain, not by seq numbers that restart in every run", () => {
    const ancestorEvent = (seq: number, type: EventType, payload: Record<string, unknown> = {}): DeliveredEvent<EventType> => ({ ...delivered(seq, type, "foreman", payload), runId: ANCESTOR_RUN_ID });
    const events = [ancestorEvent(8, "task.ready", { taskId: "T-001" }), ancestorEvent(9, "task.ready", { taskId: "T-002" }), delivered(1, "run.started", "foreman"), delivered(2, "task.tests_rejected", "foreman", { taskId: "T-002" }), delivered(3, "run.failed", "foreman")];

    const plan = planReplay(TASK_RULES, buildingWith(["T-001", "T-002"]), events);

    expect(plan.redo.map((event) => [event.runId, event.type, taskIdOf(event.payload), event.seq])).toEqual([
      [ANCESTOR_RUN_ID, "task.ready", "T-001", 8],
      [RESUMED_RUN_ID, "task.tests_rejected", "T-002", 2],
    ]);
  });
});

function capFailed(taskId: string, role: string): { readonly type: "task.failed"; readonly producer: Producer; readonly payload: Record<string, unknown> } {
  return { type: "task.failed", producer: "foreman", payload: { taskId, reason: "cap_exhausted", detail: role } };
}

const CAP_RULES: readonly TransitionRule[] = [
  ...FAILURE_CHAIN_RULES.filter((rule) => rule.eventType !== "task.tests_rejected" && rule.eventType !== "task.verified"),
  {
    name: "rejected with cap",
    eventType: "task.tests_rejected",
    acceptsTaskStatus: ["tests_pending"],
    apply: ({ state, event }) => {
      const taskId = taskIdOf(event.payload);
      const task = state.tasks[taskId];
      if (task !== undefined && task.attempts.testWriter > 1) {
        return { state, emits: [capFailed(taskId, "test-writer")], effects: [] };
      }
      return { state: withTaskChange(state, taskId, (current) => ({ ...current, attempts: { implementer: 0, testWriter: current.attempts.testWriter + 1 } })), emits: [], effects: [{ kind: "build.restart-lane" }] };
    },
  },
  {
    name: "verified red with cap",
    eventType: "task.verified",
    acceptsTaskStatus: ["verify_pending"],
    apply: ({ state, event }) => {
      const taskId = taskIdOf(event.payload);
      const task = state.tasks[taskId];
      const emit = task !== undefined && task.attempts.implementer >= 1 ? capFailed(taskId, "implementer") : { type: "task.rework" as const, producer: "foreman" as const, payload: { taskId, target: "implementer" } };
      return { state, emits: [emit], effects: [] };
    },
  },
  {
    name: "design rework with cap",
    eventType: "design.rework",
    apply: ({ state }) => {
      const recuts = state.stageAttempts.plannerRecuts + 1;
      if (recuts > 1) {
        return { state, emits: [{ type: "design.blocked", producer: "foreman", payload: { reason: "planner_cap" } }], effects: [] };
      }
      return { state: { ...state, stageAttempts: { ...state.stageAttempts, plannerRecuts: recuts } }, emits: [], effects: [{ kind: "design.plan" }] };
    },
  },
];

describe("resume after a cap failure", () => {
  const testWriterCapped = [
    delivered(1, "task.ready", "foreman", { taskId: "T-004" }),
    delivered(2, "task.tests_rejected", "foreman", { taskId: "T-004", reason: "unsupported", detail: "first" }),
    delivered(3, "task.tests_rejected", "foreman", { taskId: "T-004", reason: "unsupported", detail: "second" }),
    delivered(4, "task.failed", "foreman", { taskId: "T-004", reason: "cap_exhausted", detail: "test-writer" }),
    delivered(5, "run.failed", "foreman", { reason: "cap_exhausted" }),
  ];

  // @covers factory:DLT-012
  it("seeds the task whose test-writer cap failed the run with its test-writer attempts lowered by one", () => {
    const plan = planReplay(CAP_RULES, buildingWith(["T-004"]), testWriterCapped);

    expect(taskSummary(plan.state, "T-004")).toEqual(["tests_pending", 1]);
  });

  // @covers factory:DLT-012
  it("redoes the tests_rejected event whose transition hit the test-writer cap", () => {
    const plan = planReplay(CAP_RULES, buildingWith(["T-004"]), testWriterCapped);

    expect(plan.redo.map((event) => [event.type, event.seq])).toEqual([["task.tests_rejected", 3]]);
  });

  // @covers factory:DLT-012
  it("restarts the lane instead of failing the task when the redone tests_rejected is applied to the seed", () => {
    const plan = planReplay(CAP_RULES, buildingWith(["T-004"]), testWriterCapped);

    const outcomes = plan.redo.map((event) => reduce(CAP_RULES, plan.state, event, new Set()));
    expect(outcomes.map((outcome) => (outcome.kind === "applied" ? [outcome.result.effects, outcome.result.emits] : outcome.kind))).toEqual([[[{ kind: "build.restart-lane" }], []]]);
  });

  // @covers factory:DLT-012
  it("names the test-writer of the failed task as the granted attempt", () => {
    const plan = planReplay(CAP_RULES, buildingWith(["T-004"]), testWriterCapped);

    expect(plan.grant).toEqual({ role: "test-writer", taskId: "T-004" });
  });

  // @covers factory:DLT-012
  it("seeds the task whose implementer cap failed the run with its implementer attempts lowered by one and redoes the capped event", () => {
    const events = [
      delivered(1, "task.ready", "foreman", { taskId: "T-007" }),
      delivered(2, "task.impl_done", "implementer", { taskId: "T-007", attempt: 1 }),
      delivered(3, "task.verified", "foreman", { taskId: "T-007", result: "red" }),
      delivered(4, "task.failed", "foreman", { taskId: "T-007", reason: "cap_exhausted", detail: "implementer" }),
      delivered(5, "run.failed", "foreman"),
    ];

    const plan = planReplay(CAP_RULES, buildingWith(["T-007"]), events);

    const task = plan.state.tasks["T-007"];
    expect([task?.status, task?.attempts.implementer, plan.redo.map((event) => [event.type, event.seq]), plan.grant]).toEqual(["verify_pending", 0, [["task.verified", 3]], { role: "implementer", taskId: "T-007" }]);
  });

  // @covers factory:DLT-012
  it("seeds the run with its planner re-cuts lowered by one after design.blocked{planner_cap}", () => {
    const events = [
      delivered(1, "design.rework", "foreman", { target: "planner", reason: "first" }),
      delivered(2, "design.rework", "foreman", { target: "planner", reason: "second" }),
      delivered(3, "design.blocked", "foreman", { reason: "planner_cap" }),
      delivered(4, "run.failed", "foreman"),
    ];

    const plan = planReplay(CAP_RULES, { ...initial(), status: "planning" }, events);

    expect([plan.state.stageAttempts.plannerRecuts, plan.redo.map((event) => [event.type, event.seq]), plan.grant]).toEqual([0, [["design.rework", 2]], { role: "planner", taskId: null }]);
  });

  // @covers factory:DLT-012
  it("keeps the counters and grants nothing after a failure that is not a cap", () => {
    const events = [
      delivered(1, "task.ready", "foreman", { taskId: "T-007" }),
      delivered(2, "task.impl_done", "implementer", { taskId: "T-007", attempt: 1 }),
      delivered(3, "task.failed", "foreman", { taskId: "T-007", reason: "unparseable_handoff", detail: "verifier" }),
      delivered(4, "run.failed", "foreman"),
    ];

    const plan = planReplay(CAP_RULES, buildingWith(["T-007"]), events);

    const task = plan.state.tasks["T-007"];
    expect([task?.attempts.testWriter, task?.attempts.implementer, plan.grant]).toEqual([1, 0, null]);
  });

  // @covers factory:DLT-012
  it("never lowers a counter below zero", () => {
    const events = [delivered(1, "spec.approved", "foreman"), delivered(2, "task.failed", "foreman", { taskId: "T-001", reason: "cap_exhausted", detail: "implementer" }), delivered(3, "run.failed", "foreman")];

    const plan = planReplay(CAP_RULES, buildingWith(["T-001"]), events);

    expect(plan.state.tasks["T-001"]?.attempts.implementer).toBe(0);
  });
});
