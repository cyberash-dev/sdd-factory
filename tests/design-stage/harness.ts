import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@mozaik-ai/core";
import { createFactoryRuntime } from "../../src/bus/adapters/mozaik/runtime.js";
import { validatePayload } from "../../src/bus/domain/catalogue.js";
import type { Producer } from "../../src/bus/domain/envelope.js";
import { createRunState, type RunState } from "../../src/bus/domain/run-state.js";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import type { EffectContext } from "../../src/bus/ports/outbound/effect-runner.js";
import type { CommandRequest, CommandResult, CommandRunner } from "../../src/design-stage/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import type { ApiRoleRequest, ApiRoleRunner, ApiRoleUsage } from "../../src/shared/llm/api-role-runner.js";
import { renderTemplate } from "../../src/shared/prompts.js";
import type { SliceContext } from "../../src/shared/slice.js";

export const RUN_ID = "todo-cli-20261029-120000";

export type RoleScript = (request: ApiRoleRequest) => Promise<void>;

export interface SpecRecord {
  readonly id: string;
  readonly type: string;
  readonly status: string;
}

export const DEFAULT_RECORDS: readonly SpecRecord[] = [
  { id: "todo-cli:CTR-001", type: "Contract", status: "approved" },
  { id: "todo-cli:BEH-002", type: "Behavior", status: "approved" },
  { id: "todo-cli:CST-001", type: "Constraint", status: "approved" },
  { id: "todo-cli:SUR-001", type: "Surface", status: "approved" },
  { id: "todo-cli:OQ-001", type: "Open-Q", status: "approved" },
  { id: "todo-cli:BEH-009", type: "Behavior", status: "proposed" },
];

export interface HarnessOptions {
  readonly scripts: Partial<Record<Producer, readonly RoleScript[]>>;
  readonly records?: readonly SpecRecord[];
  readonly command?: (request: CommandRequest) => CommandResult | null;
  readonly specSourceInside?: boolean;
}

export interface Harness {
  readonly productDir: string;
  readonly slice: SliceContext;
  readonly published: PendingEvent[];
  readonly commands: CommandRequest[];
  readonly roleCalls: ApiRoleRequest[];
  readonly log: string[];
  readonly commandRunner: CommandRunner;
  context(state: RunState): EffectContext;
}

export function stateIn(status: RunState["status"], overrides: Partial<RunState> = {}): RunState {
  const base = createRunState({ runId: RUN_ID, slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
  return { ...base, status, ...overrides };
}

export function tool(request: ApiRoleRequest, name: string): Tool {
  const found = request.tools.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`tool ${name} not offered to ${request.role}`);
  }
  return found;
}

export async function writeVia(request: ApiRoleRequest, path: string, content: string): Promise<void> {
  await tool(request, "write_file").invoke({ path, content });
}

export async function readVia(request: ApiRoleRequest, path: string): Promise<string> {
  const text: unknown = await tool(request, "read_file").invoke({ path });
  return String(text);
}

export function handoffText(role: Producer, attempt: number, frontmatterLines: readonly string[]): string {
  return ["---", `role: ${role}`, `attempt: ${attempt}`, ...frontmatterLines, "---", "body: logged choices"].join("\n");
}

export function recordsJson(records: readonly SpecRecord[]): string {
  return JSON.stringify({ format_version: 1, count: records.length, records });
}

function usage(): ApiRoleUsage {
  return { model: "fake-model", inputTokens: 100, outputTokens: 10, costUsd: 0.01, inferenceCount: 1, durationMs: 50, answer: "done" };
}

function scriptedRoles(options: HarnessOptions, roleCalls: ApiRoleRequest[]): ApiRoleRunner {
  const cursors = new Map<Producer, number>();
  return {
    async run(request) {
      roleCalls.push(request);
      const index = cursors.get(request.role) ?? 0;
      cursors.set(request.role, index + 1);
      const script = options.scripts[request.role]?.[index];
      if (script === undefined) {
        throw new Error(`no script for ${request.role} invocation ${index + 1}`);
      }
      await script(request);
      return usage();
    },
  };
}

function defaultCommand(records: readonly SpecRecord[], request: CommandRequest): CommandResult {
  if (request.file === "npx" && request.args[0] === "sdd") {
    return { exitCode: 0, stdout: recordsJson(records), stderr: "" };
  }
  if (request.file === "git" && request.args[0] === "rev-parse") {
    return { exitCode: 0, stdout: "integration\n", stderr: "" };
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

function scriptedCommands(options: HarnessOptions, commands: CommandRequest[]): CommandRunner {
  return {
    async run(request) {
      commands.push(request);
      return options.command?.(request) ?? defaultCommand(options.records ?? DEFAULT_RECORDS, request);
    },
  };
}

export async function harness(options: HarnessOptions): Promise<Harness> {
  const repoRoot = await mkdtemp(join(tmpdir(), "design-stage-"));
  const productDir = join(repoRoot, "product");
  const runDir = join(productDir, ".factory", "runs", RUN_ID);
  await mkdir(join(productDir, "spec"), { recursive: true });
  await mkdir(join(runDir, "handoffs"), { recursive: true });
  await writeFile(join(productDir, "spec", "spec.md"), "# spec\n", "utf8");
  await writeFile(join(productDir, "package.json"), '{"name":"todo-cli","devDependencies":{}}\n', "utf8");
  await writeFile(join(productDir, "tsconfig.json"), '{"compilerOptions":{"strict":false},"include":["src"]}\n', "utf8");
  const specSourcePath = options.specSourceInside === false ? join(repoRoot, "source-spec.md") : join(productDir, "spec", "source.md");
  await writeFile(specSourcePath, "# organisers spec\nintent only\n", "utf8");
  const published: PendingEvent[] = [];
  const commands: CommandRequest[] = [];
  const roleCalls: ApiRoleRequest[] = [];
  const log: string[] = [];
  const commandRunner = scriptedCommands(options, commands);
  const slice: SliceContext = {
    config: DEFAULT_CONFIG,
    runId: RUN_ID,
    slug: "todo-cli",
    operator: "cyberash",
    push: false,
    paths: { repoRoot, runDir, productDir, worktreesDir: join(runDir, "worktrees"), handoffsDir: join(runDir, "handoffs"), traceDir: join(runDir, "trace"), specSourcePath, outputDir: join(repoRoot, "hidden") },
    runtime: createFactoryRuntime(RUN_ID),
    apiRoles: scriptedRoles(options, roleCalls),
    cliRoles: {
      run: () => {
        throw new Error("cli roles are not used by design-stage");
      },
    },
    prompts: { load: async (role) => `instruction for ${role}`, render: renderTemplate },
    log: (line) => {
      log.push(line);
    },
    now: () => new Date("2026-10-29T12:00:00.000Z"),
  };
  return {
    productDir,
    slice,
    published,
    commands,
    roleCalls,
    log,
    commandRunner,
    context: (state) => ({
      state,
      publish: (pendingEvent) => {
        validatePayload(pendingEvent.type, pendingEvent.payload);
        published.push(pendingEvent);
      },
    }),
  };
}

export function techMdText(options: { readonly devDependencies?: readonly string[]; readonly dependencies?: readonly string[]; readonly tsconfig?: string | null; readonly withTooling?: boolean } = {}): string {
  const tooling =
    options.withTooling === false
      ? "## 6. Something else\nnone"
      : [
          "## 6. TD-TOOLING",
          "```yaml",
          "TD-TOOLING:",
          '  node: "22"',
          '  test_cmd: "npx vitest run"',
          '  typecheck_cmd: "npx tsc --noEmit"',
          `  dependencies: [${(options.dependencies ?? []).map((item) => `"${item}"`).join(", ")}]`,
          `  dev_dependencies: [${(options.devDependencies ?? []).map((item) => `"${item}"`).join(", ")}]`,
          ...(options.tsconfig === null || options.tsconfig === undefined ? [] : [`  tsconfig: ${options.tsconfig}`]),
          "```",
        ].join("\n");
  return [
    "# Technical design: todo-cli",
    "## 1. Overview",
    "A CLI.",
    "## 2. Module map",
    "### M-01 cli",
    "- responsibility: parse argv",
    "- covers: [todo-cli:CTR-001, todo-cli:BEH-002]",
    "- owns: src/cli/**",
    "- entry: src/cli/index.ts",
    "- depends_on: []",
    "- public interface:",
    "  ```ts",
    "  export function parseArgs(argv: readonly string[]): number;",
    "  ```",
    "- notes: none",
    "### M-02 root",
    "- responsibility: wire the process",
    "- covers: [todo-cli:CST-001]",
    "- owns: src/index.ts",
    "- entry: src/index.ts",
    "- depends_on: [M-01]",
    "- public interface:",
    "  ```ts",
    "  export function main(argv: readonly string[]): Promise<number>;",
    "  ```",
    "- notes: none",
    tooling,
    "## 8. Traceability",
    "| spec id | module |",
    "|---|---|",
    "| todo-cli:CTR-001 | M-01 |",
    "| todo-cli:BEH-002 | M-01 |",
    "| todo-cli:CST-001 | M-02 |",
  ].join("\n");
}

export function verificationMdText(ids: readonly string[], extraYaml = ""): string {
  const blocks = ids.flatMap((id) => [`### ${id}`, "```yaml", `id: ${id}`, `template: ${id.includes(":CTR-") ? "Contract" : "Behavior"}`, 'obligation: "observable at the boundary"', extraYaml, "```"]);
  return ["# Verification design: todo-cli", "## 1. Scope", `${ids.length} blocks`, "## 3. Blocks", ...blocks, "## 4. Infeasible candidates", "none"].join("\n");
}

export interface TaskInput {
  readonly id: string;
  readonly covers: readonly string[];
  readonly writes: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly designRefs?: readonly string[];
  readonly title?: string;
}

export function tasksJsonText(tasks: readonly TaskInput[]): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      partition: "todo-cli",
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title ?? "do the thing",
        covers: task.covers,
        writes: task.writes,
        dependsOn: task.dependsOn ?? [],
        designRefs: task.designRefs ?? ["M-01"],
        testBudget: { maxTests: 8 },
        reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" },
      })),
    },
    null,
    2,
  );
}

export const VALID_TASKS: readonly TaskInput[] = [
  { id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-002"], writes: ["src/cli/**", "tests/cli/**"], designRefs: ["M-01"] },
  { id: "T-002", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], dependsOn: ["T-001"], designRefs: ["M-02"] },
];

export const ARCHITECT_HANDOFF_LINES: readonly string[] = ["status: complete", "modules:", "  - id: M-01", "    name: cli", "    covers: [todo-cli:CTR-001]", 'tooling: { node: "22" }'];
export const VERIFICATION_HANDOFF_LINES: readonly string[] = ["status: complete", "obligations:", "  - id: todo-cli:CTR-001", "    input_classes: 3", "    negative_oracle: true"];
export const PLANNER_HANDOFF_LINES: readonly string[] = ["status: complete", "tasks_path: design/tasks.json", "task_count: 2", "uncovered_ids: []"];
