import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTaskState } from "../../src/bus/domain/run-state.js";
import { replayEvent, type ReplayInput } from "../../src/factory/application/replay.js";
import { UsageError } from "../../src/factory/domain/argv.js";
import type { CommandRunner } from "../../src/factory/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import type { SliceFactory } from "../../src/shared/slice.js";

const RUN_ID = "todo-cli-20261030-160028";

const fakeCommands: CommandRunner = {
  async run() {
    return { exitCode: 0, stdout: "", stderr: "" };
  },
};

type RedVerdict = "red" | "rejected";

/* A build stage cut down to one lane: task.tests_written runs a scripted verifier that publishes the red check's verdict. */
function scriptedBuildStage(verdict: RedVerdict, worktreeDirsSeen: string[]): SliceFactory {
  return (slice) => ({
    name: "scripted-build-stage",
    rules: [
      {
        name: "workspace.ready -> building",
        eventType: "workspace.ready",
        apply: ({ state }) => ({
          state: { ...state, status: "building", tasks: { "T-001": { ...createTaskState({ worktree: "worktrees/T-001", covers: [], writes: [], dependsOn: [] }), status: "tests_pending" } } },
          emits: [],
          effects: [{ kind: "lane.test-writer", taskId: "T-001" }],
        }),
      },
      {
        name: "task.tests_written -> red check",
        eventType: "task.tests_written",
        acceptsTaskStatus: ["tests_pending"],
        apply: ({ state, event }) => ({ state, emits: [], effects: [{ kind: "red.check", taskId: event.payload["taskId"], attempt: event.payload["attempt"] }] }),
      },
    ],
    effects: {
      "red.check": async (_effect, context) => {
        worktreeDirsSeen.push(slice.paths.worktreesDir);
        if (verdict === "red") {
          context.publish({ type: "task.tests_red", producer: "foreman", payload: { taskId: "T-001", testsSha: "ab".repeat(20), testFiles: ["tests/t-001.test.ts"] } });
        } else {
          context.publish({ type: "task.tests_rejected", producer: "foreman", payload: { taskId: "T-001", reason: "not_red", detail: "1 test passed before the implementation" } });
        }
      },
    },
    participants: () => [],
  });
}

function traceLine(seq: number, type: string, producer: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, runId: RUN_ID, occurredAt: `2026-10-30T16:00:${String(seq).padStart(2, "0")}.000Z`, producer, seq, payload });
}

/* The failed run: the red check of T-001 never reported, the lane cap failed the task, then the run. */
async function failedRun(): Promise<{ repoRoot: string; runDir: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "replay-"));
  const runDir = join(repoRoot, ".factory", "runs", RUN_ID);
  await mkdir(join(runDir, "trace"), { recursive: true });
  await writeFile(join(runDir, "run.json"), JSON.stringify({ runId: RUN_ID, slug: "todo-cli", specPath: "specs/todo-cli.md", operator: "cyberash", startedAt: "2026-10-30T16:00:00.000Z", status: "failed", resumedFrom: null }));
  await writeFile(join(runDir, "state.json"), JSON.stringify({ runId: RUN_ID, status: "failed" }));
  const lines = [
    traceLine(1, "run.started", "foreman", { specPath: "specs/todo-cli.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" }),
    traceLine(2, "human.intervention", "foreman", { kind: "launch", note: "run launched", actor: "cyberash" }),
    traceLine(3, "workspace.ready", "foreman", { productDir: join(runDir, "product"), slug: "todo-cli", baselineId: "bl" }),
    traceLine(4, "task.tests_written", "test-writer", { taskId: "T-001", attempt: 1 }),
    traceLine(5, "task.failed", "foreman", { taskId: "T-001", reason: "cap_exhausted" }),
    traceLine(6, "run.failed", "foreman", { stage: "build", reason: "task_failed", detail: "T-001" }),
  ];
  await writeFile(join(runDir, "trace", "trace.jsonl"), `${lines.join("\n")}\n`);
  return { repoRoot, runDir };
}

function replayInput(repoRoot: string, target: ReplayInput["target"], stage: SliceFactory): ReplayInput {
  return {
    repoRoot,
    runId: RUN_ID,
    target,
    config: DEFAULT_CONFIG,
    stageSlices: [stage],
    commandRunner: fakeCommands,
    versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" },
    now: () => new Date("2026-10-30T22:00:00.000Z"),
    log: () => undefined,
    env: {},
  };
}

describe("factory replay", () => {
  // @covers factory:DLT-011
  // @covers factory:CTR-002
  it("prints the task.tests_red the red check would publish and exits 0", async () => {
    const { repoRoot } = await failedRun();

    const outcome = await replayEvent(replayInput(repoRoot, { kind: "seq", seq: 4 }, scriptedBuildStage("red", [])));

    expect([outcome.events.map((event) => [event.type, event.payload["taskId"]]), outcome.exitCode]).toEqual([[["task.tests_red", "T-001"]], 0]);
  });

  // @covers factory:DLT-011
  // @covers factory:CTR-002
  it("prints the task.tests_rejected the red check would publish and exits 1", async () => {
    const { repoRoot } = await failedRun();

    const outcome = await replayEvent(replayInput(repoRoot, { kind: "seq", seq: 4 }, scriptedBuildStage("rejected", [])));

    expect([outcome.events.map((event) => [event.type, event.payload["reason"]]), outcome.exitCode]).toEqual([[["task.tests_rejected", "not_red"]], 1]);
  });

  // @covers factory:DLT-011
  it("leaves the run's trace.jsonl and state.json byte-identical", async () => {
    const { repoRoot, runDir } = await failedRun();
    const before = [await readFile(join(runDir, "trace", "trace.jsonl"), "utf8"), await readFile(join(runDir, "state.json"), "utf8")];

    await replayEvent(replayInput(repoRoot, { kind: "seq", seq: 4 }, scriptedBuildStage("rejected", [])));

    expect([await readFile(join(runDir, "trace", "trace.jsonl"), "utf8"), await readFile(join(runDir, "state.json"), "utf8")]).toEqual(before);
  });

  // @covers factory:DLT-011
  it("runs the effect in the failed run's own worktrees directory", async () => {
    const { repoRoot, runDir } = await failedRun();
    const worktreeDirsSeen: string[] = [];

    await replayEvent(replayInput(repoRoot, { kind: "seq", seq: 4 }, scriptedBuildStage("red", worktreeDirsSeen)));

    expect(worktreeDirsSeen).toEqual([join(runDir, "worktrees")]);
  });

  // @covers factory:DLT-011
  it("with --last replays the event resume would redo first, not the run's last event", async () => {
    const { repoRoot } = await failedRun();

    const outcome = await replayEvent(replayInput(repoRoot, { kind: "last" }, scriptedBuildStage("red", [])));

    expect([outcome.replayed.type, outcome.replayed.seq]).toEqual(["task.tests_written", 4]);
  });

  // @covers factory:DLT-011
  // @covers factory:CTR-002
  it("rejects a seq absent from the run's trace with a usage error naming it", async () => {
    const { repoRoot } = await failedRun();

    const replay = replayEvent(replayInput(repoRoot, { kind: "seq", seq: 99 }, scriptedBuildStage("red", [])));

    await expect(replay).rejects.toThrow(new UsageError(`run ${RUN_ID} has no event with seq 99`));
  });

  // @covers factory:DLT-011
  // @covers factory:CTR-002
  it("rejects an unknown run with a usage error naming it", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "replay-"));

    const replay = replayEvent(replayInput(repoRoot, { kind: "last" }, scriptedBuildStage("red", [])));

    await expect(replay).rejects.toThrow(UsageError);
  });
});
