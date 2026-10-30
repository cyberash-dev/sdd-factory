import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { aProductRepo } from "./support/product.js";
import { buildingState } from "./support/state.js";
import { createRedactor } from "../../src/shared/redaction.js";
import { claudeArgv, createCliRoleRunner, laneEnvironment, parseStreamJsonLine, signalLanes, type CliRoleRequest } from "../../src/shared/llm/cli-role-runner.js";

const RESULT_LINE = JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.0421, duration_ms: 1234, usage: { input_tokens: 500, output_tokens: 120 }, modelUsage: { "claude-opus-5-5": { outputTokens: 120 }, "claude-haiku-4-5": { outputTokens: 10 } }, result: "done" });
const TOOL_LINE = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "src/a.ts" } }] } });

async function fakeClaude(lines: readonly string[], options: { readonly exitCode?: number; readonly sleepMs?: number; readonly touch?: string } = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fake-claude-"));
  const script = join(directory, "claude");
  const body = [
    "#!/bin/sh",
    "cat >/dev/null",
    options.touch === undefined ? "" : `touch '${options.touch}'`,
    ...lines.map((line) => `printf '%s\\n' '${line.replace(/'/g, `'"'"'`)}'`),
    options.sleepMs === undefined ? "" : `sleep ${options.sleepMs / 1000}`,
    `exit ${options.exitCode ?? 0}`,
  ].join("\n");
  await writeFile(script, `${body}\n`, "utf8");
  await chmod(script, 0o755);
  return script;
}

async function textOnceWritten(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (text.length > 0) {
      return text;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  return "";
}

function request(binary: string, timeoutMs = 5000): CliRoleRequest {
  return { binary, cwd: tmpdir(), prompt: "do the task", addDirs: ["/tmp/wt"], model: null, effort: null, timeoutMs, env: { PATH: process.env["PATH"] ?? "" }, transcript: null };
}

describe("claude -p lane executor", () => {
  // @covers build-stage:EXT-001
  // @covers build-stage:DLT-001
  it("parses cost, tokens, duration, the dominant model and tool uses from a complete stream-json transcript", async () => {
    const binary = await fakeClaude([TOOL_LINE, RESULT_LINE]);

    const outcome = await createCliRoleRunner().run(request(binary));

    expect([outcome.exitCode, outcome.result?.costUsd, outcome.result?.inputTokens, outcome.result?.outputTokens, outcome.result?.durationMs, outcome.result?.dominantModel, outcome.toolUses]).toEqual([
      0,
      0.0421,
      500,
      120,
      1234,
      "claude-opus-5-5",
      [{ name: "Write", input: { file_path: "src/a.ts" } }],
    ]);
  });

  it("reports a missing result message as null result with the exit code", async () => {
    const binary = await fakeClaude([TOOL_LINE], { exitCode: 1 });

    const outcome = await createCliRoleRunner().run(request(binary));

    expect([outcome.exitCode, outcome.result, outcome.timedOut]).toEqual([1, null, false]);
  });

  it("kills the subprocess on timeout and reports timedOut", async () => {
    const binary = await fakeClaude([], { sleepMs: 2000 });

    const outcome = await createCliRoleRunner().run(request(binary, 200));

    expect([outcome.timedOut, outcome.result]).toEqual([true, null]);
  });

  // @covers factory:BEH-010
  it("forwards a termination signal to every lane still running", async () => {
    const binary = await fakeClaude([], { sleepMs: 2000 });
    const runner = createCliRoleRunner();
    const running = runner.run(request(binary, 20000));

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    signalLanes("SIGTERM");
    const outcome = await running;

    expect([outcome.signal, outcome.timedOut]).toEqual(["SIGTERM", false]);
  });

  // @covers build-stage:BEH-016
  it("sends SIGTERM to a running lane subprocess when the lanes are terminated", async () => {
    const binary = await fakeClaude([], { sleepMs: 2000 });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
    const running = createCliRoleRunner().run(request(binary, 20000));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

    await harness.slice.effects["build.terminate-lanes"]?.({ kind: "build.terminate-lanes" }, { state: buildingState({}), publish: () => undefined }, harness.context);

    expect((await running).signal).toBe("SIGTERM");
  });

  // @covers build-stage:BEH-016
  it("sends SIGTERM to a running lane subprocess when the build slice shuts down", async () => {
    const binary = await fakeClaude([], { sleepMs: 2000 });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
    const running = createCliRoleRunner().run(request(binary, 20000));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

    await harness.slice.shutdown?.();

    expect((await running).signal).toBe("SIGTERM");
  });

  it("rejects when the binary does not exist", async () => {
    await expect(createCliRoleRunner().run(request("/nonexistent/claude"))).rejects.toThrow();
  });

  // @covers build-stage:DLT-002
  it("builds the print-mode argv with safe mode, every add-dir and the optional model", () => {
    const argv = claudeArgv({ ...request("claude"), addDirs: ["/a", "/b"], model: "claude-sonnet-5-5" });

    expect(argv).toEqual(["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--safe-mode", "--add-dir", "/a", "--add-dir", "/b", "--model", "claude-sonnet-5-5"]);
  });

  // @covers build-stage:DLT-002
  it("keeps safe mode when there are no add-dirs and no model", () => {
    expect(claudeArgv({ ...request("claude"), addDirs: [] })).toEqual(["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--safe-mode"]);
  });

  // @covers build-stage:DLT-006
  it("appends the reasoning effort after the model", () => {
    const argv = claudeArgv({ ...request("claude"), addDirs: [], model: "claude-sonnet-5-5", effort: "medium" });

    expect(argv).toEqual(["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--safe-mode", "--model", "claude-sonnet-5-5", "--effort", "medium"]);
  });

  // @covers build-stage:DLT-006
  it("passes the reasoning effort without a model", () => {
    const argv = claudeArgv({ ...request("claude"), addDirs: [], effort: "xhigh" });

    expect(argv).toEqual(["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--safe-mode", "--effort", "xhigh"]);
  });

  it("ignores unparseable and unrelated lines", () => {
    expect([parseStreamJsonLine("not json").kind, parseStreamJsonLine(JSON.stringify({ type: "system" })).kind]).toEqual(["other", "other"]);
  });

  it("passes only allow-listed environment variables to the lane", () => {
    const env = laneEnvironment({ PATH: "/bin", HOME: "/home/x", ANTHROPIC_API_KEY: "sk-secret", MY_TOKEN: "t", LANG: "C" });

    expect(env).toEqual({ PATH: "/bin", HOME: "/home/x", LANG: "C" });
  });

  // @covers factory:BEH-010
  it("starts no subprocess once the lanes were signalled and reports the signal without a result", async () => {
    const marker = join(await mkdtemp(join(tmpdir(), "claude-marker-")), "started");
    const binary = await fakeClaude([], { touch: marker });
    const runner = createCliRoleRunner();
    signalLanes("SIGINT");

    const outcome = await runner.run(request(binary));

    expect([outcome.signal, outcome.timedOut, outcome.result, existsSync(marker)]).toEqual(["SIGINT", false, null, false]);
  });

  // @covers factory:BEH-010
  it("still starts subprocesses from a runner created after an earlier runner's lanes were signalled", async () => {
    signalLanes("SIGTERM");
    const binary = await fakeClaude([RESULT_LINE]);

    const outcome = await createCliRoleRunner().run(request(binary));

    expect([outcome.signal, outcome.result?.resultText]).toEqual([null, "done"]);
  });
  // @covers build-stage:DLT-007
  it("keeps every stream-json line the subprocess printed in the transcript file", async () => {
    const binary = await fakeClaude([TOOL_LINE, RESULT_LINE]);
    const path = join(await mkdtemp(join(tmpdir(), "lane-transcript-")), "test-writer-1", "transcript.jsonl");

    await createCliRoleRunner().run({ ...request(binary), transcript: { path, redact: createRedactor({}) } });

    expect(await readFile(path, "utf8")).toBe(`${TOOL_LINE}\n${RESULT_LINE}\n`);
  });

  // @covers build-stage:DLT-007
  it("writes a transcript line with the configured secret value replaced", async () => {
    const binary = await fakeClaude([JSON.stringify({ type: "assistant", text: "key is sk-sentinel-0042" })]);
    const path = join(await mkdtemp(join(tmpdir(), "lane-transcript-")), "transcript.jsonl");

    await createCliRoleRunner().run({ ...request(binary), transcript: { path, redact: createRedactor({ ANTHROPIC_API_KEY: "sk-sentinel-0042" }) } });

    expect(await readFile(path, "utf8")).toBe(`${JSON.stringify({ type: "assistant", text: "key is [REDACTED]" })}\n`);
  });

  // @covers build-stage:DLT-007
  it("has the lines printed so far on disk while the subprocess runs, and keeps them after it is killed", async () => {
    const binary = await fakeClaude([TOOL_LINE], { sleepMs: 5000 });
    const path = join(await mkdtemp(join(tmpdir(), "lane-transcript-")), "transcript.jsonl");
    const running = createCliRoleRunner().run({ ...request(binary, 20000), transcript: { path, redact: createRedactor({}) } });

    const whileRunning = await textOnceWritten(path, 3000);
    signalLanes("SIGTERM");
    const outcome = await running;

    expect([whileRunning, outcome.signal, await readFile(path, "utf8")]).toEqual([`${TOOL_LINE}\n`, "SIGTERM", `${TOOL_LINE}\n`]);
  });
});
