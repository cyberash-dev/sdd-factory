import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startRun } from "../../src/factory/application/compose.js";
import { readResumeSource } from "../../src/factory/application/resume.js";
import { createTaskState, type RunState, type TaskStatus } from "../../src/bus/domain/run-state.js";
import type { RunManifest } from "../../src/factory/domain/run-manifest.js";
import type { CommandRunner } from "../../src/factory/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { createTraceSlice } from "../../src/trace/index.js";
import type { SliceFactory } from "../../src/shared/slice.js";

const fakeCommands: CommandRunner = {
  async run(command) {
    if (command === "npx") {
      return { exitCode: 0, stdout: JSON.stringify({ token: "ab".repeat(32), commit_sha: "cd".repeat(20) }), stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  },
};

const explodingSpecStage: SliceFactory = () => ({
  name: "exploding-spec-stage",
  rules: [
    {
      name: "workspace.ready explodes",
      eventType: "workspace.ready",
      apply() {
        throw new Error("handler exploded");
      },
    },
  ],
  effects: {},
  participants: () => [],
});

const stallingSpecStage: SliceFactory = () => ({
  name: "stalling-spec-stage",
  rules: [{ name: "workspace.ready -> spec_drafting", eventType: "workspace.ready", apply: ({ state }) => ({ state: { ...state, status: "spec_drafting" }, emits: [], effects: [{ kind: "spec.draft" }] }) }],
  effects: {
    "spec.draft": async () => {
      throw new Error("provider_error:429");
    },
  },
  participants: () => [],
});

async function runWith(stage: SliceFactory): Promise<{ manifest: RunManifest; stateText: string; runDir: string; failureDetail: string | null }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
  const running = await startRun({
    repoRoot,
    specPath: join(repoRoot, "todo-cli.md"),
    slug: "todo-cli",
    operator: "cyberash",
    push: false,
    outDir: null,
    config: DEFAULT_CONFIG,
    stageSlices: [stage],
    commandRunner: fakeCommands,
    versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" },
    now: () => new Date(),
    log: () => undefined,
    env: {},
  });
  const outcome = await running.terminal;
  await running.shutdown();
  return { manifest: outcome.manifest, stateText: await readFile(join(running.paths.runDir, "state.json"), "utf8"), runDir: running.paths.runDir, failureDetail: outcome.failureDetail };
}

/* A spec stage whose draft effect fails the first time it runs and publishes spec.drafted the next time. */
function flakySpecStage(drafts: { count: number }): SliceFactory {
  return () => ({
    name: "flaky-spec-stage",
    rules: [
      { name: "workspace.ready -> spec_drafting", eventType: "workspace.ready", apply: ({ state }) => ({ state: { ...state, status: "spec_drafting" }, emits: [], effects: [{ kind: "spec.draft" }] }) },
      { name: "spec.drafted -> spec_review", eventType: "spec.drafted", apply: ({ state }) => ({ state: { ...state, status: "spec_review" }, emits: [], effects: [{ kind: "spec.finish" }] }) },
    ],
    effects: {
      "spec.draft": async (_effect, context) => {
        drafts.count += 1;
        if (drafts.count === 1) {
          throw new Error("provider_error:429");
        }
        context.publish({ type: "spec.drafted", producer: "spec-analyst", payload: { attempt: 1, lintExit: 0, recordCounts: {} } });
      },
      "spec.finish": async (_effect, context) => {
        context.publish({ type: "run.published", producer: "foreman", payload: { commitSha: "ab".repeat(20), outputDir: "hidden/todo-cli", pushed: false } });
      },
    },
    participants: () => [],
  });
}

function withTaskStatus(state: RunState, taskId: string, status: TaskStatus): RunState {
  const task = state.tasks[taskId];
  return task === undefined ? state : { ...state, tasks: { ...state.tasks, [taskId]: { ...task, status } } };
}

function taskIdIn(payload: Readonly<Record<string, unknown>>): string {
  return typeof payload["taskId"] === "string" ? payload["taskId"] : "";
}

/* Two lanes start together; in the first run T-001's lane is dropped silently and T-002's lane fails the run, after that every lane approves its task. */
function twoLaneStage(launches: string[]): SliceFactory {
  return () => ({
    name: "two-lane-stage",
    rules: [
      {
        name: "workspace.ready -> building",
        eventType: "workspace.ready",
        apply: ({ state }) => ({ state: { ...state, status: "building", tasks: Object.fromEntries(["T-001", "T-002"].map((taskId) => [taskId, createTaskState({ worktree: `worktrees/${taskId}`, covers: [], writes: [], dependsOn: [] })])) }, emits: [], effects: [{ kind: "lanes.start" }] }),
      },
      { name: "task.ready -> tests_pending", eventType: "task.ready", acceptsTaskStatus: ["ready"], apply: ({ state, event }) => ({ state: withTaskStatus(state, taskIdIn(event.payload), "tests_pending"), emits: [], effects: [{ kind: "lane.run", taskId: taskIdIn(event.payload) }] }) },
      {
        name: "task.approved -> approved",
        eventType: "task.approved",
        acceptsTaskStatus: ["tests_pending"],
        apply: ({ state, event }) => {
          const next = withTaskStatus(state, taskIdIn(event.payload), "approved");
          return { state: next, emits: [], effects: Object.values(next.tasks).every((task) => task.status === "approved") ? [{ kind: "lanes.finish" }] : [] };
        },
      },
    ],
    effects: {
      "lanes.start": async (_effect, context) => {
        for (const taskId of ["T-001", "T-002"]) {
          context.publish({ type: "task.ready", producer: "foreman", payload: { taskId, worktree: `worktrees/${taskId}`, baseSha: "ab".repeat(20), covers: [], writes: [] } });
        }
      },
      "lane.run": async (effect, context) => {
        const taskId = typeof effect["taskId"] === "string" ? effect["taskId"] : "";
        launches.push(taskId);
        if (launches.length > 2) {
          context.publish({ type: "task.approved", producer: "foreman", payload: { taskId, implSha: "cd".repeat(20) } });
        } else if (taskId === "T-002") {
          throw new Error("provider_error:429");
        }
      },
      "lanes.finish": async (_effect, context) => {
        context.publish({ type: "run.published", producer: "foreman", payload: { commitSha: "ab".repeat(20), outputDir: "hidden/todo-cli", pushed: false } });
      },
    },
    participants: () => [],
  });
}

/* The test-writer lane publishes task.tests_written; the red check it triggers fails in the first run and publishes the run after that. */
function laneProducedRedoStage(redChecks: { count: number }): SliceFactory {
  return () => ({
    name: "lane-produced-redo-stage",
    rules: [
      {
        name: "workspace.ready -> building",
        eventType: "workspace.ready",
        apply: ({ state }) => ({ state: { ...state, status: "building", tasks: { "T-001": { ...createTaskState({ worktree: "worktrees/T-001", covers: [], writes: [], dependsOn: [] }), status: "tests_pending" } } }, emits: [], effects: [{ kind: "lane.write" }] }),
      },
      { name: "task.tests_written -> red check", eventType: "task.tests_written", acceptsTaskStatus: ["tests_pending"], apply: ({ state }) => ({ state, emits: [], effects: [{ kind: "red.check" }] }) },
    ],
    effects: {
      "lane.write": async (_effect, context, slice) => {
        const lane = slice.runtime.joinLane("test-writer", "T-001");
        try {
          context.publish({ type: "task.tests_written", producer: "test-writer", payload: { taskId: "T-001", attempt: 1, handoffPath: "handoffs/T-001.md", costUsd: null, inputTokens: 0, outputTokens: 0, durationMs: 0 } });
        } finally {
          slice.runtime.leaveLane(lane);
        }
      },
      "red.check": async (_effect, context) => {
        redChecks.count += 1;
        if (redChecks.count === 1) {
          throw new Error("provider_error:429");
        }
        context.publish({ type: "run.published", producer: "foreman", payload: { commitSha: "ab".repeat(20), outputDir: "hidden/todo-cli", pushed: false } });
      },
    },
    participants: () => [],
  });
}

async function traceTypes(runDir: string): Promise<readonly (readonly [string, string])[]> {
  const lines = (await readFile(join(runDir, "trace", "trace.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
  return lines
    .map((line) => JSON.parse(line) as { type: string; producer: string; payload: Record<string, unknown> })
    .filter((record) => record.producer !== "runtime")
    .map((record) => [record.type, typeof record.payload["kind"] === "string" ? record.payload["kind"] : ""] as const);
}

const hangingSpecStage: SliceFactory = () => ({
  name: "hanging-spec-stage",
  rules: [{ name: "workspace.ready -> spec_drafting", eventType: "workspace.ready", apply: ({ state }) => ({ state: { ...state, status: "spec_drafting" }, emits: [], effects: [{ kind: "spec.draft" }] }) }],
  effects: {
    "spec.draft": () => new Promise<void>(() => undefined),
  },
  participants: () => [],
});

async function stateReaches(runDir: string, status: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const text = await readFile(join(runDir, "state.json"), "utf8").catch(() => "");
    if (text.includes(`"status": "${status}"`)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`state did not reach ${status} within 5s`);
}

async function startHanging(repoRoot: string): Promise<ReturnType<typeof startRun>> {
  return startRun({ repoRoot, specPath: join(repoRoot, "todo-cli.md"), slug: "todo-cli", operator: "cyberash", push: false, outDir: null, config: DEFAULT_CONFIG, stageSlices: [createTraceSlice({ env: {} }), hangingSpecStage], commandRunner: fakeCommands, versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }, now: () => new Date(), log: () => undefined, env: {} });
}

describe("terminated run", () => {
  // @covers factory:BEH-010
  it("ends a run waiting on a role as run.failed terminated at the current stage when the process is signalled", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
    const running = await startHanging(repoRoot);
    await stateReaches(running.paths.runDir, "spec_drafting");

    running.terminate("SIGTERM");
    const outcome = await running.terminal;
    await running.shutdown();

    const written: RunManifest = JSON.parse(await readFile(join(running.paths.runDir, "run.json"), "utf8"));
    expect([outcome.manifest.status, outcome.manifest.reason, outcome.manifest.stage, outcome.failureDetail, written.status]).toEqual(["failed", "terminated", "spec", "SIGTERM", "failed"]);
  });

  // @covers factory:BEH-010
  it("ignores a signal after the terminal event and keeps the first reason", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
    const running = await startHanging(repoRoot);
    running.terminate("SIGINT");
    await running.terminal;

    running.terminate("SIGTERM");
    await running.shutdown();

    const written: RunManifest = JSON.parse(await readFile(join(running.paths.runDir, "run.json"), "utf8"));
    expect([written.status, written.reason]).toEqual(["failed", "terminated"]);
  });

  // @covers factory:BEH-010
  it("leaves a terminated run resumable without --force", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
    const running = await startHanging(repoRoot);
    running.terminate("SIGTERM");
    await running.terminal;
    await running.shutdown();

    const source = await readResumeSource(repoRoot, running.runId, false);

    expect(source.manifest.status).toBe("failed");
  });
});

describe("resumed run", () => {
  // @covers factory:BEH-009
  it("continues a failed run from its last effectful event inside the failed run's product directory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
    const drafts = { count: 0 };
    const stage = flakySpecStage(drafts);
    const input = { repoRoot, specPath: join(repoRoot, "todo-cli.md"), slug: "todo-cli", operator: "cyberash", push: false, outDir: null, config: DEFAULT_CONFIG, stageSlices: [createTraceSlice({ env: {} }), stage], commandRunner: fakeCommands, versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }, log: () => undefined, env: {} };
    const first = await startRun({ ...input, now: () => new Date("2026-10-30T16:00:00.000Z") });
    const firstOutcome = await first.terminal;
    await first.shutdown();

    const second = await startRun({ ...input, now: () => new Date("2026-10-30T17:00:00.000Z"), resume: { fromRunId: first.runId, note: "provider is back", force: false } });
    const secondOutcome = await second.terminal;
    await second.shutdown();

    const trace = await traceTypes(second.paths.runDir);
    expect({
      firstStatus: firstOutcome.manifest.status,
      secondStatus: secondOutcome.manifest.status,
      resumedFrom: secondOutcome.manifest.resumedFrom,
      sameProduct: second.paths.productDir === first.paths.productDir,
      separateRunDir: second.paths.runDir !== first.paths.runDir,
      drafts: drafts.count,
      head: trace.slice(0, 4),
    }).toEqual({
      firstStatus: "failed",
      secondStatus: "published",
      resumedFrom: first.runId,
      sameProduct: true,
      separateRunDir: true,
      drafts: 2,
      head: [
        ["run.started", ""],
        ["human.intervention", "fix_between_runs"],
        ["workspace.ready", ""],
        ["spec.drafted", ""],
      ],
    });
  });

  // @covers factory:BEH-009
  it("names the failed run and the redo event in the fix_between_runs note", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
    const stage = flakySpecStage({ count: 0 });
    const input = { repoRoot, specPath: join(repoRoot, "todo-cli.md"), slug: "todo-cli", operator: "cyberash", push: false, outDir: null, config: DEFAULT_CONFIG, stageSlices: [createTraceSlice({ env: {} }), stage], commandRunner: fakeCommands, versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }, log: () => undefined, env: {} };
    const first = await startRun({ ...input, now: () => new Date("2026-10-30T16:00:00.000Z") });
    await first.terminal;
    await first.shutdown();

    const second = await startRun({ ...input, now: () => new Date("2026-10-30T17:00:00.000Z"), resume: { fromRunId: first.runId, note: "provider is back", force: false } });
    await second.terminal;
    await second.shutdown();

    const lines = (await readFile(join(second.paths.runDir, "trace", "trace.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
    const intervention = lines.map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> }).find((record) => record.type === "human.intervention");
    expect(intervention?.payload).toEqual({ kind: "fix_between_runs", actor: "cyberash", note: `resume of ${first.runId} from workspace.ready seq 4; provider is back` });
  });
});

describe("resumed run with several lanes in flight", () => {
  async function resumedTwoLaneRun(): Promise<{ firstRunId: string; secondRunDir: string; secondStatus: string; launches: readonly string[] }> {
    const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
    const launches: string[] = [];
    const input = { repoRoot, specPath: join(repoRoot, "todo-cli.md"), slug: "todo-cli", operator: "cyberash", push: false, outDir: null, config: DEFAULT_CONFIG, stageSlices: [createTraceSlice({ env: {} }), twoLaneStage(launches)], commandRunner: fakeCommands, versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }, log: () => undefined, env: {} };
    const first = await startRun({ ...input, now: () => new Date("2026-10-30T16:00:00.000Z") });
    await first.terminal;
    await first.shutdown();
    const second = await startRun({ ...input, now: () => new Date("2026-10-30T17:00:00.000Z"), resume: { fromRunId: first.runId, note: "provider is back", force: false } });
    const secondOutcome = await second.terminal;
    await second.shutdown();
    return { firstRunId: first.runId, secondRunDir: second.paths.runDir, secondStatus: secondOutcome.manifest.status, launches };
  }

  async function busRecords(runDir: string): Promise<readonly { type: string; producer: string; payload: Record<string, unknown> }[]> {
    const lines = (await readFile(join(runDir, "trace", "trace.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
    return lines.map((line) => JSON.parse(line) as { type: string; producer: string; payload: Record<string, unknown> }).filter((record) => record.producer !== "runtime");
  }

  // @covers factory:DLT-006
  it("restarts both lanes that were in flight and publishes the run", async () => {
    const { secondRunDir, secondStatus, launches } = await resumedTwoLaneRun();

    const head = (await busRecords(secondRunDir)).slice(0, 4).map((record) => [record.type, taskIdIn(record.payload)]);
    expect({ secondStatus, launches, head }).toEqual({
      secondStatus: "published",
      launches: ["T-001", "T-002", "T-001", "T-002"],
      head: [
        ["run.started", ""],
        ["human.intervention", ""],
        ["task.ready", "T-001"],
        ["task.ready", "T-002"],
      ],
    });
  });

  // @covers factory:DLT-006
  it("names every redone event in the fix_between_runs note", async () => {
    const { firstRunId, secondRunDir } = await resumedTwoLaneRun();

    const intervention = (await busRecords(secondRunDir)).find((record) => record.type === "human.intervention");
    expect(intervention?.payload["note"]).toBe(`resume of ${firstRunId} from task.ready seq 5, task.ready seq 6; provider is back`);
  });
});

describe("resumed run with a lane-produced redo event", () => {
  // @covers factory:BEH-009
  it("republishes task.tests_written from the test-writer lane and publishes the run", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "compose-"));
    const redChecks = { count: 0 };
    const input = { repoRoot, specPath: join(repoRoot, "todo-cli.md"), slug: "todo-cli", operator: "cyberash", push: false, outDir: null, config: DEFAULT_CONFIG, stageSlices: [createTraceSlice({ env: {} }), laneProducedRedoStage(redChecks)], commandRunner: fakeCommands, versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }, log: () => undefined, env: {} };
    const first = await startRun({ ...input, now: () => new Date("2026-10-30T16:00:00.000Z") });
    await first.terminal;
    await first.shutdown();

    const second = await startRun({ ...input, now: () => new Date("2026-10-30T17:00:00.000Z"), resume: { fromRunId: first.runId, note: null, force: false } });
    const secondOutcome = await second.terminal;
    await second.shutdown();

    expect([secondOutcome.manifest.status, secondOutcome.failureDetail, redChecks.count]).toEqual(["published", null, 2]);
  });
});

describe("composed run", () => {
  // @covers factory:BEH-007
  it("turns a throwing rule into a failed run with reason runtime_error and a finalised manifest", async () => {
    const { manifest, stateText } = await runWith(explodingSpecStage);

    const state: { status: string; failure: { reason: string; stage: string } } = JSON.parse(stateText);
    expect([manifest.status, manifest.reason, state.status, state.failure.reason, state.failure.stage]).toEqual(["failed", "runtime_error", "failed", "runtime_error", "workspace"]);
  });

  // @covers factory:CTR-002
  it("hands the failure detail to the terminal outcome so the report can print it", async () => {
    const { failureDetail } = await runWith(stallingSpecStage);

    expect(failureDetail?.includes("provider_error:429")).toBe(true);
  });

  it("turns a rejected effect into a failed run at the stage the run was in", async () => {
    const { manifest, stateText } = await runWith(stallingSpecStage);

    const state: { failure: { stage: string; detail: string } } = JSON.parse(stateText);
    expect([manifest.status, state.failure.stage, state.failure.detail.includes("provider_error:429")]).toEqual(["failed", "spec", true]);
  });

  // @covers factory:INV-001
  it("reaches the terminal event without a controlling terminal or stdin", async () => {
    const { manifest, runDir } = await runWith(explodingSpecStage);

    const written: RunManifest = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    expect([process.stdin.isTTY ?? false, manifest.status, written.status]).toEqual([false, "failed", "failed"]);
  });
});
