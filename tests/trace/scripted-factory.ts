import { InputTokenDetails, ModelMessageItem, OutputTokenDetails, TokenUsage, type InferenceOutput, type InferenceRunner, type SemanticEvent } from "@mozaik-ai/core";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFactoryRuntime, createReactor, type FactoryRuntime } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload, Producer } from "../../src/bus/domain/envelope.js";
import { createRunState, createTaskState, type RunStatus } from "../../src/bus/domain/run-state.js";
import type { TransitionRule } from "../../src/bus/domain/transition.js";
import { DEFAULT_CONFIG, type FactoryConfig } from "../../src/shared/config.js";
import { createApiRoleRunner } from "../../src/shared/llm/api-role-runner.js";
import type { TokenCounts } from "../../src/shared/llm/pricing.js";
import type { SliceContext } from "../../src/shared/slice.js";
import type { Environment } from "../../src/trace/domain/redaction.js";
import { copyTraceTo, createTraceSlice, type TraceSlice } from "../../src/trace/index.js";

export const RUN_ID = "todo-cli-20261029-120000";
export const SLUG = "todo-cli";
export const SHA = "0123456789abcdef0123456789abcdef01234567";

export interface HarnessOptions {
  readonly env?: Environment;
  readonly pricing?: FactoryConfig["pricing"];
  readonly prepare?: (paths: { readonly traceDir: string; readonly productDir: string }) => Promise<void>;
}

export interface Harness {
  readonly root: string;
  readonly traceDir: string;
  readonly productDir: string;
  readonly publishedTraceDir: string;
  readonly runtime: FactoryRuntime;
  readonly engine: RunEngine;
  readonly slice: TraceSlice;
  readonly published: DeliveredEvent<EventType>[];
  publish(type: EventType, producer: Producer, payload: EventPayload): Promise<DeliveredEvent<EventType>>;
  infer(role: Producer, model: string, usage: TokenCounts | null, taskId?: string): Promise<void>;
  settle(): Promise<void>;
}

function statusRule(eventType: EventType, status: RunStatus): TransitionRule {
  return { name: `${eventType} -> ${status}`, eventType, apply: ({ state }) => ({ state: { ...state, status }, emits: [], effects: [] }) };
}

const rules: readonly TransitionRule[] = [
  statusRule("run.started", "workspace"),
  statusRule("workspace.ready", "spec_drafting"),
  statusRule("spec.approved", "designing"),
  statusRule("design.tasks.ready", "building"),
  statusRule("assembly.started", "assembling"),
  statusRule("run.published", "published"),
  {
    name: "task.ready -> task registered",
    eventType: "task.ready",
    apply: ({ state, event }) => {
      const taskId = String(event.payload["taskId"]);
      const task = createTaskState({ worktree: String(event.payload["worktree"]), covers: [], writes: [], dependsOn: [] });
      return { state: { ...state, tasks: { ...state.tasks, [taskId]: task } }, emits: [], effects: [] };
    },
  },
  {
    name: "run.failed -> failed",
    eventType: "run.failed",
    apply: ({ state, event }) => ({
      state: { ...state, status: "failed", failure: { stage: "spec", reason: String(event.payload["reason"]), detail: String(event.payload["detail"]) } },
      emits: [],
      effects: [],
    }),
  },
];

function scriptedInferenceRunner(steps: InferenceOutput[]): InferenceRunner {
  return {
    async run(): Promise<InferenceOutput> {
      const step = steps.shift();
      if (step === undefined) {
        throw new Error("no scripted inference left");
      }
      return step;
    },
    async *stream(): AsyncGenerator<SemanticEvent> {
      yield* [];
    },
  };
}

interface ContextParts {
  readonly root: string;
  readonly traceDir: string;
  readonly productDir: string;
  readonly pricing: FactoryConfig["pricing"];
  readonly runtime: FactoryRuntime;
  readonly apiRoles: SliceContext["apiRoles"];
}

function sliceContextFor(parts: ContextParts): SliceContext {
  return {
    config: { ...DEFAULT_CONFIG, pricing: parts.pricing },
    runId: RUN_ID,
    slug: SLUG,
    operator: "cyberash",
    push: false,
    paths: {
      repoRoot: parts.root,
      runDir: join(parts.root, "run"),
      productDir: parts.productDir,
      worktreesDir: join(parts.root, "run", "worktrees"),
      handoffsDir: join(parts.root, "run", "handoffs"),
      traceDir: parts.traceDir,
      specSourcePath: join(parts.root, "spec.md"),
      outputDir: join(parts.root, "hidden", SLUG),
    },
    runtime: parts.runtime,
    apiRoles: parts.apiRoles,
    cliRoles: {
      run: async () => {
        throw new Error("cli roles are not exercised by trace tests");
      },
    },
    prompts: { load: async () => "", render: (template) => template },
    log: () => undefined,
    now: () => new Date(),
  };
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "trace-run-"));
  const traceDir = join(root, "run", "trace");
  const productDir = join(root, "product");
  const publishedTraceDir = join(root, "hidden", SLUG, "trace");
  await mkdir(productDir, { recursive: true });
  await options.prepare?.({ traceDir, productDir });
  const steps: InferenceOutput[] = [];
  const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: scriptedInferenceRunner(steps) });
  const pricing = options.pricing ?? { m: { inputPerMillion: 3, outputPerMillion: 15 } };
  const published: DeliveredEvent<EventType>[] = [];
  const settled: Promise<unknown>[] = [];
  const publisher = {
    publish: (pending: Parameters<FactoryRuntime["publisher"]["publish"]>[0]): DeliveredEvent<EventType> => {
      const delivered = runtime.publisher.publish(pending);
      published.push(delivered);
      return delivered;
    },
  };
  const engine = new RunEngine({
    initialState: createRunState({ runId: RUN_ID, slug: SLUG, operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" }),
    rules,
    store: { write: async () => undefined },
    publisher,
    effects: { run: async () => undefined },
    log: () => undefined,
  });
  const apiRoles = createApiRoleRunner(runtime, pricing);
  const context = sliceContextFor({ root, traceDir, productDir, pricing, runtime, apiRoles });
  const slice = createTraceSlice(options.env === undefined ? {} : { env: options.env })(context);
  for (const participant of slice.participants(context)) {
    runtime.join(participant);
  }
  runtime.join(createReactor("foreman", Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => settled.push(engine.consume(event))]))));
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 5; round += 1) {
      await Promise.all(settled.splice(0));
      await new Promise((resolve) => setImmediate(resolve));
    }
    await slice.shutdown();
  };
  return {
    root,
    traceDir,
    productDir,
    publishedTraceDir,
    runtime,
    engine,
    slice,
    published,
    publish: async (type, producer, payload) => {
      const delivered = publisher.publish({ type, producer, payload });
      await settle();
      return delivered;
    },
    infer: async (role, model, usage, taskId) => {
      const tokenUsage = usage === null ? undefined : new TokenUsage(usage.inputTokens, usage.outputTokens, usage.inputTokens + usage.outputTokens, new InputTokenDetails(0), new OutputTokenDetails(0));
      steps.push({ items: [ModelMessageItem.rehydrate({ text: "done" })], tokenUsage, rowResponse: null });
      const request = { role, instruction: "role", message: "go", model, tools: [], timeoutMs: 5000, maxOutputTokens: 100 };
      await apiRoles.run(taskId === undefined ? request : { ...request, taskId });
      await settle();
    },
    settle,
  };
}

export interface Nudge {
  readonly kind: "launch" | "fix_between_runs" | "mid_run_nudge";
  readonly actor: string;
  readonly note: string;
}

export interface ScriptOptions {
  readonly titles?: Readonly<Record<string, string>>;
  readonly tasksPath?: string;
  readonly nudges?: readonly Nudge[];
  readonly failureDetail?: string;
  readonly afterEvent?: (event: DeliveredEvent<EventType>) => Promise<void>;
}

export function tasksJson(titles: Readonly<Record<string, string>>): string {
  const tasks = Object.entries(titles).map(([id, title], index) => ({
    id,
    title,
    covers: [`${SLUG}:REQ-00${index + 1}`],
    writes: [`src/${id}/**`, `tests/${id}/**`],
    dependsOn: [],
    designRefs: ["M-01"],
    testBudget: { maxTests: 5 },
    reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" },
  }));
  return JSON.stringify({ schemaVersion: 1, partition: SLUG, tasks });
}

function laneCost(attempt: number, costUsd: number | null): EventPayload {
  return { attempt, handoffPath: "handoffs/tasks/T/handoff.md", costUsd, inputTokens: 100, outputTokens: 10, durationMs: 1000 };
}

async function step(harness: Harness, options: ScriptOptions, type: EventType, producer: Producer, payload: EventPayload): Promise<void> {
  const delivered = await harness.publish(type, producer, payload);
  await options.afterEvent?.(delivered);
}

async function lane(harness: Harness, options: ScriptOptions, taskId: string, implCost: number | null, withReviewer: boolean): Promise<void> {
  await step(harness, options, "task.tests_written", "test-writer", { taskId, ...laneCost(1, implCost === null ? null : 0.1) });
  await step(harness, options, "task.tests_red", "foreman", { taskId, testsSha: SHA, testFiles: [`tests/${taskId}/a.test.ts`] });
  await step(harness, options, "task.impl_done", "implementer", { taskId, ...laneCost(1, implCost) });
  await step(harness, options, "task.verified", "foreman", { taskId, result: "green", evidencePath: "verifier.json", testsUnchanged: true, writeSetOk: true });
  if (withReviewer) {
    await harness.infer("reviewer", "m", { inputTokens: 1000, outputTokens: 200 });
  }
  await step(harness, options, "task.reviewed", "reviewer", { taskId, decision: "approve", target: "none", reportPath: `reviews/${taskId}.md` });
  await step(harness, options, "task.approved", "foreman", { taskId, implSha: SHA });
}

export async function runUntilDesign(harness: Harness, options: ScriptOptions = {}): Promise<void> {
  await step(harness, options, "run.started", "foreman", { specPath: "spec.md", slug: SLUG, operator: "cyberash", mode: "autonomous" });
  await step(harness, options, "workspace.ready", "foreman", { productDir: harness.productDir, slug: SLUG, baselineId: `${SLUG}:BL-001` });
  for (const nudge of options.nudges ?? []) {
    await step(harness, options, "human.intervention", "foreman", { kind: nudge.kind, note: nudge.note, actor: nudge.actor });
  }
  await harness.infer("spec-analyst", "m", { inputTokens: 100, outputTokens: 20 });
  await step(harness, options, "spec.drafted", "spec-analyst", { attempt: 1, lintExit: 0, recordCounts: { Behavior: 2 } });
  await step(harness, options, "spec.approved", "foreman", { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 3 });
  await Promise.all([harness.infer("architect", "m", { inputTokens: 300, outputTokens: 30 }), harness.infer("verification-designer", "m", { inputTokens: 200, outputTokens: 20 })]);
  await step(harness, options, "design.tech.ready", "architect", { path: "design/tech.md" });
  await step(harness, options, "design.verification.ready", "verification-designer", { path: "design/verification.md" });
}

export async function happyPath(harness: Harness, options: ScriptOptions = {}): Promise<void> {
  await runUntilDesign(harness, options);
  const titles = options.titles ?? { "T-001": "Domain model", "T-002": "CLI entry" };
  const tasksPath = options.tasksPath ?? "design/tasks.json";
  await mkdir(join(harness.productDir, "design"), { recursive: true });
  await writeFile(join(harness.productDir, "design", "tasks.json"), tasksJson(titles), "utf8");
  await step(harness, options, "design.tasks.ready", "planner", { path: tasksPath, taskCount: 2 });
  await step(harness, options, "task.ready", "foreman", { taskId: "T-001", worktree: "/wt/T-001", baseSha: SHA, covers: [], writes: [] });
  await step(harness, options, "task.ready", "foreman", { taskId: "T-002", worktree: "/wt/T-002", baseSha: SHA, covers: [], writes: [] });
  await lane(harness, options, "T-001", 0.42, true);
  await lane(harness, options, "T-002", null, false);
  await step(harness, options, "assembly.started", "assembler", { taskOrder: ["T-001", "T-002"] });
  await step(harness, options, "assembly.verified", "assembler", { result: "green", step: "sdd_ready", evidencePath: "assembly/report.md", failingCovers: [] });
  await copyTraceTo(harness.traceDir, harness.publishedTraceDir);
  await step(harness, options, "run.published", "assembler", { commitSha: SHA, outputDir: join(harness.root, "hidden", SLUG), pushed: false });
}

export async function failingPath(harness: Harness, options: ScriptOptions = {}): Promise<void> {
  const detail = options.failureDetail ?? "lint cap reached after 5 cycles";
  await step(harness, options, "run.started", "foreman", { specPath: "spec.md", slug: SLUG, operator: "cyberash", mode: "autonomous" });
  await step(harness, options, "workspace.ready", "foreman", { productDir: harness.productDir, slug: SLUG, baselineId: `${SLUG}:BL-001` });
  await harness.infer("spec-analyst", "m", { inputTokens: 100, outputTokens: 20 });
  await step(harness, options, "spec.blocked", "spec-analyst", { reason: "lint_cap", detail });
  await step(harness, options, "run.failed", "foreman", { stage: "spec", reason: "lint_cap", detail });
}
