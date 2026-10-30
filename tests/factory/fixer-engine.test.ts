import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { createExecFileCommandRunner } from "../../src/build-stage/adapters/outbound/exec-file-command-runner.js";
import { createFactoryRuntime, createRuntimeObserver, type FactoryRuntime } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import { createRunState, createTaskState, type RunState } from "../../src/bus/domain/run-state.js";
import { SIMPLE_FIX_RULE } from "../../src/bus/domain/simple-fix-rule.js";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import { DEFAULT_CONFIG, type RoleModels } from "../../src/shared/config.js";
import { createGitWorkingTree } from "../../src/shared/fixer/adapters/outbound/git-working-tree.js";
import { runSimpleFix, type FixCheck, type SimpleFixRequest, type SimpleFixResult } from "../../src/shared/fixer/application/run-simple-fix.js";
import { fixScopeOf } from "../../src/shared/fixer/domain/fix-scope.js";
import { claudeArgv, type CliRoleOutcome, type CliRoleRequest, type CliRoleRunner } from "../../src/shared/llm/cli-role-runner.js";
import { createPromptLibrary } from "../../src/shared/prompts.js";
import type { SliceContext } from "../../src/shared/slice.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const RUN_ID = "greeter-20261030-120000";
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };

type FixerScript = (cwd: string, run: number) => Promise<void>;

interface FixerHarness {
  readonly directory: string;
  readonly runDir: string;
  readonly requests: CliRoleRequest[];
  readonly events: DeliveredEvent<EventType>[];
  readonly senders: string[];
  readonly runtime: FactoryRuntime;
  fix(request: Omit<SimpleFixRequest, "directory">): Promise<SimpleFixResult>;
  settledState(): Promise<RunState>;
}

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

async function aRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fixer-product-"));
  await put(dir, ".gitignore", "node_modules\n");
  for (const [path, content] of Object.entries(files)) {
    await put(dir, path, content);
  }
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: GIT_ENV });
  await execFileAsync("git", ["add", "-A"], { cwd: dir, env: GIT_ENV });
  await execFileAsync("git", ["commit", "-q", "-m", "base"], { cwd: dir, env: GIT_ENV });
  return dir;
}

function cliOutcome(resultText: string): CliRoleOutcome {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    result: { isError: false, costUsd: 0.03, inputTokens: 700, outputTokens: 60, durationMs: 2000, resultText, dominantModel: "claude-opus-5-5" },
    toolUses: [],
    stderrTail: "",
    durationMs: 2100,
  };
}

function scriptedFixer(script: FixerScript, requests: CliRoleRequest[], overrides: Partial<CliRoleOutcome>): CliRoleRunner {
  return {
    async run(request) {
      requests.push(request);
      await script(request.cwd, requests.length);
      return { ...cliOutcome(`run ${requests.length}: changed what the output named`), ...overrides };
    },
  };
}

function aState(simpleFixes: Readonly<Record<string, number>> = {}): RunState {
  const base = createRunState({ runId: RUN_ID, slug: "greeter", operator: "cyberash", startedAt: "2026-10-30T12:00:00.000Z" });
  return { ...base, status: "building", simpleFixes, tasks: { "T-001": createTaskState({ worktree: "/wt", covers: [], writes: [], dependsOn: [] }) } };
}

async function aFixerHarness(files: Readonly<Record<string, string>>, script: FixerScript, initialState: RunState = aState(), outcomeOverrides: Partial<CliRoleOutcome> = {}, models: RoleModels = DEFAULT_CONFIG.models): Promise<FixerHarness> {
  const directory = await aRepo(files);
  const runDir = await mkdtemp(join(tmpdir(), "fixer-run-"));
  const requests: CliRoleRequest[] = [];
  const events: DeliveredEvent<EventType>[] = [];
  const senders: string[] = [];
  const consumed: Promise<unknown>[] = [];
  const runtime = createFactoryRuntime(RUN_ID);
  runtime.join(createRuntimeObserver("probe", (event) => (event.type === "fix.attempted" ? senders.push(event.producerId) : undefined)));
  const engine: RunEngine = new RunEngine({
    initialState,
    rules: [SIMPLE_FIX_RULE],
    store: { write: async () => undefined },
    publisher: {
      publish(pending: PendingEvent) {
        const delivered = runtime.publisher.publish(pending);
        events.push(delivered);
        consumed.push(engine.consume(delivered));
        return delivered;
      },
    },
    effects: { run: async () => undefined },
    log: () => undefined,
  });
  const slice: SliceContext = {
    config: { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, simpleFixes: 2 }, models },
    runId: RUN_ID,
    slug: "greeter",
    operator: "cyberash",
    push: false,
    paths: { repoRoot: REPO_ROOT, runDir, productDir: directory, worktreesDir: join(runDir, "worktrees"), handoffsDir: join(runDir, "handoffs"), traceDir: join(runDir, "trace"), specSourcePath: join(REPO_ROOT, "spec.md"), outputDir: join(runDir, "out") },
    runtime,
    apiRoles: { run: async () => { throw new Error("no API role in fixer tests"); } },
    cliRoles: scriptedFixer(script, requests, outcomeOverrides),
    prompts: createPromptLibrary(join(REPO_ROOT, "prompts")),
    log: () => undefined,
    now: () => new Date("2026-10-30T12:00:00.000Z"),
  };
  const deps = { tree: createGitWorkingTree(createExecFileCommandRunner()), delay: async () => undefined };
  return {
    directory,
    runDir,
    requests,
    events,
    senders,
    runtime,
    fix: (request) => runSimpleFix(slice, deps, { state: engine.state, publish: (pending) => engine.publish(pending) }, { ...request, directory }),
    settledState: async () => {
      await Promise.all(consumed);
      return engine.state;
    },
  };
}

function fileCheck(directory: string, path: string, needle: string): () => Promise<FixCheck> {
  return async () => {
    const text = await readFile(join(directory, path), "utf8");
    return text.includes(needle) ? { passed: true, output: "" } : { passed: false, output: `${path}: still missing ${needle}` };
  };
}

const STUB = "export function greet(name: string): string {\n  throw new Error(\"not implemented\");\n}\n";
const RED_TEST = "import { greet } from \"../src/greet.js\";\nimport { format } from \"../src/format.js\";\n";
const TSC_OUTPUT = "tests/greet.test.ts(2,24): error TS2307: Cannot find module '../src/format.js'.";

function redSuiteRequest(directory: string): Omit<SimpleFixRequest, "directory"> {
  return {
    trigger: "red_suite_error",
    owner: "test-writer",
    unit: "T-001",
    taskId: "T-001",
    scope: fixScopeOf({ trigger: "red_suite_error", writes: ["src/**", "tests/**"] }),
    formatOnly: [],
    failureOutput: TSC_OUTPUT,
    check: fileCheck(directory, "src/format.ts", "export function format"),
  };
}

const addFormatStub: FixerScript = async (cwd) => put(cwd, "src/format.ts", "export function format(text: string): string {\n  throw new Error(\"not implemented\");\n}\n");

describe("simple-fixer engine", () => {
  // @covers factory:BEH-012
  // @covers bus:CTR-009
  it("publishes one fix.attempted with outcome fixed, the changed files and the subprocess cost when the fixer repairs a file inside the allowed paths", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB, "tests/greet.test.ts": RED_TEST }, addFormatStub);

    const result = await harness.fix(redSuiteRequest(harness.directory));

    expect([result.verdict, harness.events.map((event) => event.payload)]).toEqual([
      "fixed",
      [
        {
          stage: "build",
          taskId: "T-001",
          unit: "T-001",
          owner: "test-writer",
          trigger: "red_suite_error",
          attempt: 1,
          outcome: "fixed",
          filesChanged: ["src/format.ts"],
          answerPath: "handoffs/T-001/simple-fixer/answer-run1.md",
          costUsd: 0.03,
          inputTokens: 700,
          outputTokens: 60,
          durationMs: 2000,
        },
      ],
    ]);
  });

  // @covers factory:BEH-012
  // @covers bus:DLT-005
  it("increments simpleFixes for the owner and unit once per run", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB, "tests/greet.test.ts": RED_TEST }, addFormatStub);

    await harness.fix(redSuiteRequest(harness.directory));

    expect((await harness.settledState()).simpleFixes).toEqual({ "test-writer:T-001": 1 });
  });

  // @covers factory:BEH-012
  it("saves the fixer's final answer as answer-run1.md under the unit's simple-fixer handoff directory", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB, "tests/greet.test.ts": RED_TEST }, addFormatStub);

    await harness.fix(redSuiteRequest(harness.directory));

    expect(await readFile(join(harness.runDir, "handoffs/T-001/simple-fixer/answer-run1.md"), "utf8")).toBe("run 1: changed what the output named\n");
  });

  // @covers bus:DLT-005
  // @covers bus:BEH-007
  it("sends fix.attempted from a simple-fixer participant joined with capability unit:T-001 that leaves after the run", async () => {
    const capabilitiesDuringRun: string[][] = [];
    let runtimeRef: FactoryRuntime | null = null;
    const harness = await aFixerHarness({ "src/greet.ts": STUB }, async (cwd, run) => {
      const fixers = runtimeRef?.state.getParticipants().filter((participant) => participant.getManifest().name === "simple-fixer") ?? [];
      capabilitiesDuringRun.push(...fixers.map((participant) => [participant.getId(), ...(participant.getManifest().capabilities ?? [])]));
      await addFormatStub(cwd, run);
    });
    runtimeRef = harness.runtime;

    await harness.fix(redSuiteRequest(harness.directory));

    const remaining = harness.runtime.state.getParticipants().filter((participant) => participant.getManifest().name === "simple-fixer");
    expect([capabilitiesDuringRun.map((entry) => entry.slice(1)), harness.senders, remaining]).toEqual([[["lane", "unit:T-001"]], [capabilitiesDuringRun[0]?.[0]], []]);
  });

  // @covers factory:BEH-012
  it("puts the failing command's output verbatim and the allowed paths into the fixer prompt", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB }, addFormatStub);

    await harness.fix(redSuiteRequest(harness.directory));

    const prompt = harness.requests[0]?.prompt ?? "";
    expect([prompt.includes(TSC_OUTPUT), prompt.includes("- `src/**`"), harness.requests[0]?.cwd]).toEqual([true, true, harness.directory]);
  });

  // @covers factory:DLT-010
  it("spawns the fixer on the simple-fixer lane model and effort instead of models.lane", async () => {
    const models: RoleModels = { ...DEFAULT_CONFIG.models, lane: "claude-haiku-4-5", lanes: { "simple-fixer": "claude-opus-5-5" }, effort: { "simple-fixer": "medium" } };
    const harness = await aFixerHarness({ "src/greet.ts": STUB }, addFormatStub, aState(), {}, models);

    await harness.fix(redSuiteRequest(harness.directory));

    expect(harness.requests.map((request) => claudeArgv(request).slice(-4))).toEqual([["--model", "claude-opus-5-5", "--effort", "medium"]]);
  });

  // @covers factory:BEH-012
  it("discards a green-trigger run that edits a frozen test, restores the test byte-equal and runs the fixer again", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB, "tests/greet.test.ts": RED_TEST }, async (cwd, run) => {
      await put(cwd, run === 1 ? "tests/greet.test.ts" : "src/format.ts", "export function format(text: string): string {\n  return text;\n}\n");
    });

    const result = await harness.fix({
      trigger: "green_typecheck",
      owner: "implementer",
      unit: "T-001",
      taskId: "T-001",
      scope: fixScopeOf({ trigger: "green_typecheck", writes: ["src/**", "tests/**"] }),
      formatOnly: [],
      failureOutput: TSC_OUTPUT,
      check: fileCheck(harness.directory, "src/format.ts", "export function format"),
    });

    expect([result.runs.map((run) => [run.outcome, run.filesChanged]), await readFile(join(harness.directory, "tests/greet.test.ts"), "utf8")]).toEqual([
      [
        ["discarded", ["tests/greet.test.ts"]],
        ["fixed", ["src/format.ts"]],
      ],
      RED_TEST,
    ]);
  });

  // @covers factory:BEH-012
  it("discards a spec_yaml_invalid run that changes a field of a record that already parsed and leaves the file equal to the snapshot", async () => {
    const spec = "```yaml\nid: app:BEH-001\ntitle: greets\n```\n\n```yaml\nid: app:BEH-002\ntitle: broken: scalar\n```\n";
    const harness = await aFixerHarness({ "spec/spec.md": spec }, async (cwd) => {
      await put(cwd, "spec/spec.md", "```yaml\nid: app:BEH-001\ntitle: greets loudly\n```\n\n```yaml\nid: app:BEH-002\ntitle: \"broken: scalar\"\n```\n");
    });

    const result = await harness.fix({
      trigger: "spec_yaml_invalid",
      owner: "spec-analyst",
      unit: "spec",
      taskId: null,
      scope: fixScopeOf({ trigger: "spec_yaml_invalid" }),
      formatOnly: [{ path: "spec/spec.md", parse: yamlRecords }],
      failureOutput: "spec/spec.md:9 yaml_invalid: Nested mappings are not allowed in compact mappings",
      check: async () => ({ passed: true, output: "" }),
    });

    expect([result.runs[0]?.outcome, result.runs[0]?.violations, await readFile(join(harness.directory, "spec/spec.md"), "utf8")]).toEqual(["discarded", ["spec/spec.md: app:BEH-001 changed"], spec]);
  });

  // @covers factory:CST-005
  it("runs a fixer that never repairs the failure exactly caps.simpleFixes times, feeding each run the latest output, then reports cap_reached", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB }, async (cwd, run) => put(cwd, "src/greet.ts", `${STUB}// run ${run}\n`));

    const result = await harness.fix({ ...redSuiteRequest(harness.directory), check: async () => ({ passed: false, output: `still failing after ${harness.requests.length}` }) });

    expect([result.verdict, harness.events.map((event) => [event.payload["attempt"], event.payload["outcome"]]), harness.requests[1]?.prompt.includes("still failing after 1"), result.lastFailureOutput]).toEqual([
      "cap_reached",
      [
        [1, "unfixed"],
        [2, "unfixed"],
      ],
      true,
      "still failing after 2",
    ]);
  });

  // @covers factory:CST-005
  it("starts no fixer run when the state already holds caps.simpleFixes attempts for the pair", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB }, addFormatStub, aState({ "test-writer:T-001": 2 }));

    const result = await harness.fix(redSuiteRequest(harness.directory));

    expect([result.verdict, result.runs, harness.requests.length, harness.events.length]).toEqual(["cap_reached", [], 0, 0]);
  });

  // @covers factory:CST-005
  it("continues the attempt numbering from the state counter of the pair", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB }, addFormatStub, aState({ "test-writer:T-001": 1, "test-writer:T-002": 2 }));

    await harness.fix(redSuiteRequest(harness.directory));

    expect(harness.events.map((event) => event.payload["attempt"])).toEqual([2]);
  });

  // @covers factory:BEH-010
  it("ends the loop after a run whose subprocess ended on a termination signal, with no fix.attempted and no second run", async () => {
    const harness = await aFixerHarness({ "src/greet.ts": STUB }, async () => undefined, aState(), { exitCode: null, signal: "SIGTERM", result: null });

    const result = await harness.fix({ ...redSuiteRequest(harness.directory), check: async () => ({ passed: false, output: "still failing" }) });

    expect([result.verdict, result.runs, harness.requests.length, harness.events.length]).toEqual(["terminated", [], 1, 0]);
  });
});

function yamlRecords(text: string): ReadonlyMap<string, string> {
  const records = new Map<string, string>();
  for (const match of text.matchAll(/```yaml\n([\s\S]*?)```/g)) {
    try {
      const parsed: unknown = YAML.parse(match[1] ?? "");
      if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") {
        records.set(parsed.id, JSON.stringify(parsed));
      }
    } catch {
      continue;
    }
  }
  return records;
}
