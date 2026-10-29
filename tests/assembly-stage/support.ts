import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createFactoryRuntime } from "../../src/bus/adapters/mozaik/runtime.js";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../src/bus/domain/envelope.js";
import { createRunState, type RunState, type RunStatus, type TaskState, type TaskStatus } from "../../src/bus/domain/run-state.js";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import type { EffectContext } from "../../src/bus/ports/outbound/effect-runner.js";
import { createExecFileCommandRunner } from "../../src/assembly-stage/adapters/outbound/exec-file-command-runner.js";
import type { CommandInvocation, CommandResult, CommandRunner } from "../../src/assembly-stage/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG, type FactoryConfig } from "../../src/shared/config.js";
import type { ApiRoleRequest, ApiRoleRunner, ApiRoleUsage } from "../../src/shared/llm/api-role-runner.js";
import { createPromptLibrary } from "../../src/shared/prompts.js";
import type { SliceContext } from "../../src/shared/slice.js";

const execFileAsync = promisify(execFile);

export const RUN_ID = "todo-cli-20261029-120000";
export const SLUG = "todo-cli";

export function coversMarker(id: string): string {
  return `// @${"covers"} ${id}\n`;
}

export function ok(stdout = ""): CommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 7, timedOut: false };
}

export function failed(exitCode: number, stderr: string, stdout = ""): CommandResult {
  return { exitCode, stdout, stderr, durationMs: 9, timedOut: false };
}

export type CommandScript = (invocation: CommandInvocation) => CommandResult | undefined | Promise<CommandResult | undefined>;

export interface FakeCommandRunner extends CommandRunner {
  readonly calls: CommandInvocation[];
}

export function fakeCommandRunner(script: CommandScript): FakeCommandRunner {
  const real = createExecFileCommandRunner();
  const calls: CommandInvocation[] = [];
  return {
    calls,
    async run(invocation) {
      calls.push(invocation);
      const scripted = await script(invocation);
      return scripted ?? real.run(invocation);
    },
  };
}

export function commandLine(invocation: CommandInvocation): string {
  return invocation.argv.join(" ");
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

export async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
}

export async function initRepo(dir: string, branch: string, files: Readonly<Record<string, string>>): Promise<string> {
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "-q", "-b", branch);
  await git(dir, "config", "user.email", "factory@example.test");
  await git(dir, "config", "user.name", "factory");
  await git(dir, "config", "commit.gpgsign", "false");
  return commitFiles(dir, files, "base");
}

export async function commitFiles(dir: string, files: Readonly<Record<string, string>>, message: string): Promise<string> {
  await writeFiles(dir, files);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

export function taskState(input: {
  readonly status?: TaskStatus;
  readonly covers?: readonly string[];
  readonly writes?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly implSha?: string | null;
  readonly baseSha?: string | null;
  readonly implementerAttempts?: number;
  readonly testWriterAttempts?: number;
}): TaskState {
  return {
    status: input.status ?? "approved",
    attempts: { implementer: input.implementerAttempts ?? 1, testWriter: input.testWriterAttempts ?? 1 },
    handoffReruns: {},
    baseSha: input.baseSha ?? null,
    testsSha: null,
    implSha: input.implSha ?? null,
    worktree: "/wt",
    covers: input.covers ?? [],
    writes: input.writes ?? [],
    dependsOn: input.dependsOn ?? [],
    lastEvent: "task.approved",
  };
}

export function runState(input: { readonly status: RunStatus; readonly tasks: Readonly<Record<string, TaskState>>; readonly assemblyRounds?: number; readonly plannerRecuts?: number }): RunState {
  const base = createRunState({ runId: RUN_ID, slug: SLUG, operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
  return { ...base, status: input.status, tasks: input.tasks, stageAttempts: { ...base.stageAttempts, assemblyRounds: input.assemblyRounds ?? 0, plannerRecuts: input.plannerRecuts ?? 0 } };
}

export function delivered(type: EventType, payload: EventPayload, seq = 1): DeliveredEvent<EventType> {
  return { type, runId: RUN_ID, occurredAt: "2026-10-29T12:00:01.000Z", producer: "assembler", payload, seq };
}

export interface CollectingContext extends EffectContext {
  readonly published: PendingEvent[];
}

export function collectingContext(state: RunState): CollectingContext {
  const published: PendingEvent[] = [];
  return { state, published, publish: (pending) => published.push(pending) };
}

export function silentApiRoles(): ApiRoleRunner {
  return { run: () => Promise.reject(new Error("api role not expected")) };
}

export function scriptedApiRoles(script: (request: ApiRoleRequest) => Promise<string | null>): ApiRoleRunner & { readonly requests: ApiRoleRequest[] } {
  const requests: ApiRoleRequest[] = [];
  return {
    requests,
    async run(request): Promise<ApiRoleUsage> {
      requests.push(request);
      const handoff = await script(request);
      if (handoff !== null) {
        const write = request.tools.find((tool) => tool.name === "write_file");
        if (write === undefined) {
          throw new Error("write_file tool missing");
        }
        await write.invoke({ path: handoffPathOf(request), content: handoff });
      }
      return { model: request.model, inputTokens: 120, outputTokens: 30, costUsd: 0.001, inferenceCount: 1, durationMs: 5, answer: "done" };
    },
  };
}

function handoffPathOf(request: ApiRoleRequest): string {
  const match = /Handoff to write \(attempt \d+\): (\S+)/.exec(request.message);
  if (match?.[1] === undefined) {
    throw new Error("handoff path missing from the triage message");
  }
  return match[1];
}

export interface TestSliceInput {
  readonly root: string;
  readonly apiRoles?: ApiRoleRunner;
  readonly config?: FactoryConfig;
  readonly push?: boolean;
  readonly log?: string[];
}

export function sliceContext(input: TestSliceInput): SliceContext {
  const runDir = join(input.root, "run");
  const log = input.log ?? [];
  return {
    config: input.config ?? DEFAULT_CONFIG,
    runId: RUN_ID,
    slug: SLUG,
    operator: "cyberash",
    push: input.push ?? true,
    paths: {
      repoRoot: join(input.root, "team"),
      runDir,
      productDir: join(input.root, "product"),
      worktreesDir: join(runDir, "worktrees"),
      handoffsDir: join(runDir, "handoffs"),
      traceDir: join(runDir, "trace"),
      specSourcePath: join(input.root, "spec.md"),
      outputDir: join(input.root, "team", "hidden", SLUG),
    },
    runtime: createFactoryRuntime(RUN_ID),
    apiRoles: input.apiRoles ?? silentApiRoles(),
    cliRoles: { run: () => Promise.reject(new Error("cli role not expected")) },
    prompts: createPromptLibrary(join(process.cwd(), "prompts")),
    log: (line) => log.push(line),
    now: () => new Date("2026-10-29T12:00:00.000Z"),
  };
}

export function vitestReport(input: { readonly failing?: readonly { readonly file: string; readonly name: string; readonly message: string }[]; readonly passing?: readonly string[] }): string {
  const failing = input.failing ?? [];
  const passing = input.passing ?? [];
  return JSON.stringify({
    numFailedTestSuites: failing.length,
    numFailedTests: failing.length,
    success: failing.length === 0,
    testResults: [
      ...failing.map((test) => ({ name: test.file, status: "failed", message: "", assertionResults: [{ fullName: test.name, title: test.name, status: "failed", failureMessages: [test.message] }] })),
      ...passing.map((file) => ({ name: file, status: "passed", message: "", assertionResults: [{ fullName: "passes", title: "passes", status: "passed", failureMessages: [] }] })),
    ],
  });
}

export function sddReadyReport(violations: readonly { readonly kind: string; readonly id?: string; readonly file?: string }[]): string {
  return JSON.stringify({ ok: violations.length === 0, error: null, violations });
}

export async function flush(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
