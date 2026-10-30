import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startRun } from "../../src/factory/application/compose.js";
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

async function traceTypes(runDir: string): Promise<readonly (readonly [string, string])[]> {
  const lines = (await readFile(join(runDir, "trace", "trace.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
  return lines
    .map((line) => JSON.parse(line) as { type: string; producer: string; payload: Record<string, unknown> })
    .filter((record) => record.producer !== "runtime")
    .map((record) => [record.type, typeof record.payload["kind"] === "string" ? record.payload["kind"] : ""] as const);
}

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
