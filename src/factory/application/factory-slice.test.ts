import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFactoryRuntime } from "../../bus/adapters/mozaik/runtime.js";
import type { EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../bus/domain/envelope.js";
import { createRunState, createTaskState, type RunState } from "../../bus/domain/run-state.js";
import type { PendingEvent, TransitionRule } from "../../bus/domain/transition.js";
import { DEFAULT_CONFIG } from "../../shared/config.js";
import { createCliRoleRunner } from "../../shared/llm/cli-role-runner.js";
import { createApiRoleRunner } from "../../shared/llm/api-role-runner.js";
import { createPromptLibrary } from "../../shared/prompts.js";
import type { SliceContext } from "../../shared/slice.js";
import type { RunManifest } from "../domain/run-manifest.js";
import { createFactorySlice, type TerminalOutcome } from "./factory-slice.js";
import { runPaths } from "./compose.js";

const RUN_ID = "todo-cli-20261029-120000";

async function harness(): Promise<{ context: SliceContext; terminal: TerminalOutcome[]; rule: (type: EventType) => TransitionRule }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "factory-"));
  const runtime = createFactoryRuntime(RUN_ID);
  const context: SliceContext = {
    config: DEFAULT_CONFIG,
    runId: RUN_ID,
    slug: "todo-cli",
    operator: "cyberash",
    push: true,
    paths: runPaths(repoRoot, RUN_ID, "todo-cli", "specs/todo.md", null),
    runtime,
    apiRoles: createApiRoleRunner(runtime, {}),
    cliRoles: createCliRoleRunner(),
    prompts: createPromptLibrary(join(repoRoot, "prompts")),
    log: () => undefined,
    now: () => new Date("2026-10-29T12:30:00.000Z"),
  };
  const terminal: TerminalOutcome[] = [];
  const slice = createFactorySlice({
    commandRunner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" },
    specPath: "specs/todo.md",
    startedAt: "2026-10-29T12:00:00.000Z",
    onTerminal: (outcome) => terminal.push(outcome),
  })(context);
  const rule = (type: EventType): TransitionRule => {
    const found = slice.rules.find((candidate) => candidate.eventType === type);
    if (found === undefined) {
      throw new Error(`no rule for ${type}`);
    }
    return found;
  };
  return { context, terminal, rule: Object.assign(rule, { slice }) };
}

function event(type: EventType, payload: EventPayload): DeliveredEvent<EventType> {
  return { type, runId: RUN_ID, occurredAt: "2026-10-29T12:00:01.000Z", producer: "foreman", payload, seq: 1 };
}

const initial = (): RunState => createRunState({ runId: RUN_ID, slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });

describe("factory slice rules", () => {
  // @covers factory:BEH-001
  it("moves run.started to workspace, records the launch intervention and schedules the bootstrap", async () => {
    const { rule } = await harness();

    const result = rule("run.started").apply({ state: initial(), event: event("run.started", { specPath: "specs/todo.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" }) });

    expect([result.state.status, result.emits.map((pending: PendingEvent) => [pending.type, pending.payload["kind"], pending.payload["actor"]]), result.effects.map((effect) => effect.kind)]).toEqual([
      "workspace",
      [["human.intervention", "launch", "cyberash"]],
      ["factory.bootstrap"],
    ]);
  });

  // @covers factory:BEH-005
  it("moves run.failed to failed with the failure recorded and schedules finalisation", async () => {
    const { rule } = await harness();

    const result = rule("run.failed").apply({ state: { ...initial(), status: "building" }, event: event("run.failed", { stage: "build", reason: "cap_exhausted", detail: "T-001" }) });

    expect([result.state.status, result.state.failure, result.effects]).toEqual(["failed", { stage: "build", reason: "cap_exhausted", detail: "T-001" }, [{ kind: "factory.finalize", outcome: "failed", stage: "build", reason: "cap_exhausted", detail: "T-001" }]]);
  });

  // @covers factory:BEH-006
  it("moves run.published to published and schedules finalisation with the publication facts", async () => {
    const { rule } = await harness();

    const result = rule("run.published").apply({ state: { ...initial(), status: "publishing" }, event: event("run.published", { commitSha: "ab".repeat(20), outputDir: "hidden/todo-cli/", pushed: false }) });

    expect([result.state.status, result.effects]).toEqual(["published", [{ kind: "factory.finalize", outcome: "published", commitSha: "ab".repeat(20), outputDir: "hidden/todo-cli/", pushed: false }]]);
  });

  // @covers factory:CTR-003
  it("finalises a failed run into run.json with status failed, stage, reason and task counters", async () => {
    const { context, terminal, rule } = await harness();
    const slice = Object.getOwnPropertyDescriptor(rule, "slice")?.value;
    const state: RunState = {
      ...initial(),
      status: "failed",
      failure: { stage: "build", reason: "cap_exhausted", detail: "T-002" },
      tasks: {
        "T-001": { ...createTaskState({ worktree: "/wt/1", covers: [], writes: [], dependsOn: [] }), status: "approved", attempts: { implementer: 2, testWriter: 1 } },
        "T-002": { ...createTaskState({ worktree: "/wt/2", covers: [], writes: [], dependsOn: [] }), status: "failed", attempts: { implementer: 3, testWriter: 2 } },
      },
    };

    await slice.effects["factory.finalize"]({ kind: "factory.finalize", outcome: "failed", stage: "build", reason: "cap_exhausted", detail: "T-002" }, { state, publish: () => undefined }, context);

    const manifest: RunManifest = JSON.parse(await readFile(join(context.paths.runDir, "run.json"), "utf8"));
    expect([manifest.status, manifest.stage, manifest.reason, manifest.endedAt, manifest.counters, terminal.length]).toEqual(["failed", "build", "cap_exhausted", "2026-10-29T12:30:00.000Z", { tasks: 2, tasksApproved: 1, tasksFailed: 1, reworks: 4 }, 1]);
  });

  it("finalises a published run into run.json with the commit, output directory and push flag", async () => {
    const { context, terminal, rule } = await harness();
    const slice = Object.getOwnPropertyDescriptor(rule, "slice")?.value;
    const state: RunState = { ...initial(), status: "published" };

    await slice.effects["factory.finalize"]({ kind: "factory.finalize", outcome: "published", commitSha: "ab".repeat(20), outputDir: "hidden/todo-cli/", pushed: true }, { state, publish: () => undefined }, context);

    const manifest: RunManifest = JSON.parse(await readFile(join(context.paths.runDir, "run.json"), "utf8"));
    expect([manifest.status, manifest.stage, manifest.commitSha, manifest.outputDir, manifest.pushed, terminal[0]?.manifest.status]).toEqual(["published", "publish", "ab".repeat(20), "hidden/todo-cli/", true, "published"]);
  });
});
