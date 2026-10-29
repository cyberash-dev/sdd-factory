import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startRun } from "../../src/factory/application/compose.js";
import type { CommandRunner } from "../../src/factory/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import type { SliceFactory } from "../../src/shared/slice.js";
import { createTraceSlice } from "../../src/trace/index.js";

const SENTINEL = "sk-ant-sentinel-0123456789";

const fakeCommands: CommandRunner = {
  async run(command) {
    return command === "npx" ? { exitCode: 0, stdout: JSON.stringify({ token: "ab".repeat(32), commit_sha: "cd".repeat(20) }), stderr: "" } : { exitCode: 0, stdout: "", stderr: "" };
  },
};

const leakingStage: SliceFactory = () => ({
  name: "leaking-stage",
  rules: [
    {
      name: "workspace.ready leaks the key into an error",
      eventType: "workspace.ready",
      apply() {
        throw new Error(`provider rejected key ${SENTINEL}`);
      },
    },
  ],
  effects: {},
  participants: () => [],
});

async function filesUnder(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? (entry.name === "product" || entry.name === "node_modules" ? [] : filesUnder(join(dir, entry.name))) : [join(dir, entry.name)])));
  return nested.flat();
}

describe("secret redaction across run artefacts", () => {
  // @covers factory:POL-003
  it("writes no environment secret into run.json, state.json or the trace files even when an error message carries it", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "redact-"));
    const env = { ANTHROPIC_API_KEY: SENTINEL, PATH: "/usr/bin" };
    const running = await startRun({
      repoRoot,
      specPath: join(repoRoot, "todo-cli.md"),
      slug: "todo-cli",
      operator: "cyberash",
      push: false,
      outDir: null,
      config: DEFAULT_CONFIG,
      stageSlices: [createTraceSlice({ env }), leakingStage],
      commandRunner: fakeCommands,
      versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" },
      now: () => new Date(),
      log: () => undefined,
      env,
    });
    await running.terminal;
    await running.shutdown();

    const files = await filesUnder(running.paths.runDir);
    const leaking = (await Promise.all(files.map(async (file) => [file, (await readFile(file, "utf8")).includes(SENTINEL)] as const))).filter(([, leaks]) => leaks).map(([file]) => file);
    const state = await readFile(join(running.paths.runDir, "state.json"), "utf8");
    expect([files.length > 2, leaking, state.includes("[REDACTED]")]).toEqual([true, [], true]);
  });
});
