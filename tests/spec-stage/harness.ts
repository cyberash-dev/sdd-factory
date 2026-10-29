import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFactoryRuntime } from "../../src/bus/adapters/mozaik/runtime.js";
import { validatePayload } from "../../src/bus/domain/catalogue.js";
import { createRunState, type RunState } from "../../src/bus/domain/run-state.js";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import type { EffectContext } from "../../src/bus/ports/outbound/effect-runner.js";
import { DEFAULT_CONFIG, type FactoryConfig } from "../../src/shared/config.js";
import type { ApiRoleRequest, ApiRoleRunner } from "../../src/shared/llm/api-role-runner.js";
import { createPromptLibrary } from "../../src/shared/prompts.js";
import type { SliceContext } from "../../src/shared/slice.js";
import type { CommandResult, CommandRunner } from "../../src/spec-stage/ports/command-runner.js";

export const RUN_ID = "todo-cli-20261029-120000";
export const SLUG = "todo-cli";
export const OPERATOR = "cyberash";

export interface StageWorkspace {
  readonly repoRoot: string;
  readonly runDir: string;
  readonly productDir: string;
  readonly handoffsDir: string;
  readonly specSourcePath: string;
  readonly specPath: string;
  readonly gaPath: string;
  readonly assumptionsPath: string;
}

export async function stageWorkspace(specText: string): Promise<StageWorkspace> {
  const repoRoot = await mkdtemp(join(tmpdir(), "spec-stage-"));
  const runDir = join(repoRoot, ".factory", "runs", RUN_ID);
  const productDir = join(runDir, "product");
  const handoffsDir = join(runDir, "handoffs");
  await mkdir(join(productDir, "spec"), { recursive: true });
  await mkdir(join(productDir, "src"), { recursive: true });
  await mkdir(handoffsDir, { recursive: true });
  await writeFile(join(productDir, "src", "index.ts"), "export const secret = 'IMPLEMENTATION';\n", "utf8");
  const specSourcePath = join(repoRoot, "source.md");
  await writeFile(specSourcePath, "# todo-cli\n\n`todo add <text>` stores an item.\n", "utf8");
  const specPath = join(productDir, "spec", "spec.md");
  await writeFile(specPath, specText, "utf8");
  return { repoRoot, runDir, productDir, handoffsDir, specSourcePath, specPath, gaPath: join(productDir, "spec", "review", "ga.md"), assumptionsPath: join(productDir, "spec", "assumptions.md") };
}

export type RoleScript = (request: ApiRoleRequest) => Promise<void>;

export interface FakeRoles extends ApiRoleRunner {
  readonly requests: ApiRoleRequest[];
}

export function scriptedRoles(scripts: readonly RoleScript[]): FakeRoles {
  const requests: ApiRoleRequest[] = [];
  return {
    requests,
    async run(request) {
      const script = scripts[requests.length];
      requests.push(request);
      if (script === undefined) {
        throw new Error(`unexpected role invocation #${requests.length} (${request.role})`);
      }
      await script(request);
      return { model: request.model, inputTokens: 10, outputTokens: 5, costUsd: null, inferenceCount: 1, durationMs: 1, answer: "done" };
    },
  };
}

export interface FakeCommands extends CommandRunner {
  readonly calls: string[][];
}

export function scriptedCommands(reply: (argv: readonly string[], call: number) => CommandResult): FakeCommands {
  const calls: string[][] = [];
  return {
    calls,
    async run(argv) {
      calls.push([...argv]);
      return reply(argv, calls.length);
    },
  };
}

export const exitZero = (): CommandResult => ({ exitCode: 0, stdout: "", stderr: "" });

export function sddReplies(overrides: Readonly<Record<string, CommandResult>>): (argv: readonly string[]) => CommandResult {
  return (argv) => overrides[argv[0] ?? ""] ?? exitZero();
}

export function sliceContext(workspace: StageWorkspace, roles: ApiRoleRunner, config: FactoryConfig = DEFAULT_CONFIG): SliceContext {
  return {
    config,
    runId: RUN_ID,
    slug: SLUG,
    operator: OPERATOR,
    push: false,
    paths: {
      repoRoot: workspace.repoRoot,
      runDir: workspace.runDir,
      productDir: workspace.productDir,
      worktreesDir: join(workspace.runDir, "worktrees"),
      handoffsDir: workspace.handoffsDir,
      traceDir: join(workspace.runDir, "trace"),
      specSourcePath: workspace.specSourcePath,
      outputDir: join(workspace.repoRoot, "hidden", SLUG),
    },
    runtime: createFactoryRuntime(RUN_ID),
    apiRoles: roles,
    cliRoles: {
      run: () => Promise.reject(new Error("cli roles are not part of the spec stage")),
    },
    prompts: createPromptLibrary(join(process.cwd(), "prompts")),
    log: () => undefined,
    now: () => new Date("2026-10-29T12:00:00.000Z"),
  };
}

export function runStateAt(status: RunState["status"], overrides: Partial<RunState> = {}): RunState {
  const base = createRunState({ runId: RUN_ID, slug: SLUG, operator: OPERATOR, startedAt: "2026-10-29T12:00:00.000Z" });
  return { ...base, status, ...overrides };
}

export interface CapturedEffectContext {
  readonly context: EffectContext;
  readonly published: PendingEvent[];
}

export function effectContext(state: RunState): CapturedEffectContext {
  const published: PendingEvent[] = [];
  return {
    published,
    context: {
      state,
      publish(pending) {
        validatePayload(pending.type, pending.payload);
        published.push(pending);
      },
    },
  };
}

export function analystHandoff(attempt: number, overrides: Readonly<Record<string, unknown>> = {}): string {
  const fields: Record<string, unknown> = {
    role: "spec-analyst",
    attempt,
    status: "complete",
    lint_exit: 0,
    records: { behaviors: 2, contracts: 1, invariants: 0, scenarios: 0, constraints: 1, policies: 2, open_questions: 1, assumptions: 1 },
    ...overrides,
  };
  return `---\n${JSON.stringify(fields)}\n---\nanalyst notes\n`;
}

export function criticHandoff(attempt: number, decision: "accept" | "rework", overrides: Readonly<Record<string, unknown>> = {}): string {
  const fields: Record<string, unknown> = { role: "spec-critic", attempt, status: "complete", decision, findings: [], assumptions_added: [], ...overrides };
  return `---\n${JSON.stringify(fields)}\n---\ncritic verdict\n`;
}

export function gaReview(round: number, decision: "accept" | "rework", findingsYaml: string): string {
  return `# Spec review: ${SLUG}, round ${round}\n\ndecision: ${decision}\n\n## Findings\n\`\`\`yaml\n${findingsYaml}\n\`\`\`\n\n## Assumptions\n\n## Open-Q decisions\n| Open-Q | option | finding | rationale |\n\n## Coverage\nnone\n`;
}

export function writeText(path: string, text: string): Promise<void> {
  return mkdir(join(path, ".."), { recursive: true }).then(() => writeFile(path, text, "utf8"));
}

export const CLI_SPEC = `## 5. Surfaces
\`\`\`yaml
---
id: todo-cli:SUR-001
type: Surface
lifecycle: {status: proposed}
partition_id: todo-cli
name: todo-cli
boundary_type: cli
members: [todo-cli:CTR-001]
version: "0.1.0"
---
\`\`\`

## 7. Data contracts
\`\`\`yaml
---
id: todo-cli:CTR-001
type: Contract
lifecycle: {status: proposed}
partition_id: todo-cli
title: todo add <text>
surface_ref: todo-cli:SUR-001
---
\`\`\`

## 17. Open questions
\`\`\`yaml
---
id: todo-cli:OQ-001
type: Open-Q
lifecycle: {status: proposed}
partition_id: todo-cli
question: Is blank text rejected?
blocking: no
default_if_unresolved: a
---
\`\`\`

## 18. Assumptions
\`\`\`yaml
---
id: todo-cli:ASM-001
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: todo-cli
assumption: blank text is rejected with exit 2
source_open_q: todo-cli:OQ-001
blocking: no
---
\`\`\`
`;
