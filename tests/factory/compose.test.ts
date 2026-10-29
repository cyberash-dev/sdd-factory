import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startRun } from "../../src/factory/application/compose.js";
import type { RunManifest } from "../../src/factory/domain/run-manifest.js";
import type { CommandRunner } from "../../src/factory/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
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

async function runWith(stage: SliceFactory): Promise<{ manifest: RunManifest; stateText: string; runDir: string }> {
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
  return { manifest: outcome.manifest, stateText: await readFile(join(running.paths.runDir, "state.json"), "utf8"), runDir: running.paths.runDir };
}

describe("composed run", () => {
  // @covers factory:BEH-007
  it("turns a throwing rule into a failed run with reason runtime_error and a finalised manifest", async () => {
    const { manifest, stateText } = await runWith(explodingSpecStage);

    const state: { status: string; failure: { reason: string; stage: string } } = JSON.parse(stateText);
    expect([manifest.status, manifest.reason, state.status, state.failure.reason, state.failure.stage]).toEqual(["failed", "runtime_error", "failed", "runtime_error", "workspace"]);
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
