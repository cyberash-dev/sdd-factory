import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createFactoryRuntime, createReactor } from "../../bus/adapters/mozaik/runtime.js";
import { AtomicJsonStore } from "../../bus/adapters/outbound/atomic-json-store.js";
import { RunEngine } from "../../bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../bus/domain/envelope.js";
import { createRunState } from "../../bus/domain/run-state.js";
import type { FactoryConfig } from "../../shared/config.js";
import { createApiRoleRunner, type ApiRoleRunner } from "../../shared/llm/api-role-runner.js";
import { createCliRoleRunner, type CliRoleRunner } from "../../shared/llm/cli-role-runner.js";
import { createPromptLibrary } from "../../shared/prompts.js";
import { createRedactor, redactDeep } from "../../shared/redaction.js";
import { composeEffectRunner, composeRules, type RunPaths, type Slice, type SliceContext, type SliceFactory } from "../../shared/slice.js";
import { runIdOf } from "../domain/run-id.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { createFactorySlice, type TerminalOutcome } from "./factory-slice.js";
import type { ToolchainVersions } from "./product-scaffold.js";

export interface StartRunInput {
  readonly repoRoot: string;
  readonly specPath: string;
  readonly slug: string;
  readonly operator: string;
  readonly push: boolean;
  readonly outDir: string | null;
  readonly config: FactoryConfig;
  readonly stageSlices: readonly SliceFactory[];
  readonly commandRunner: CommandRunner;
  readonly versions: ToolchainVersions;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly roleRunners?: { readonly apiRoles?: ApiRoleRunner; readonly cliRoles?: CliRoleRunner };
}

export interface RunningFactory {
  readonly runId: string;
  readonly paths: RunPaths;
  readonly terminal: Promise<TerminalOutcome>;
  shutdown(): Promise<void>;
}

export function runPaths(repoRoot: string, runId: string, slug: string, specPath: string, outDir: string | null): RunPaths {
  const runDir = join(repoRoot, ".factory", "runs", runId);
  return {
    repoRoot,
    runDir,
    productDir: join(runDir, "product"),
    worktreesDir: join(runDir, "worktrees"),
    handoffsDir: join(runDir, "handoffs"),
    traceDir: join(runDir, "trace"),
    specSourcePath: specPath,
    outputDir: outDir ?? join(repoRoot, "hidden", slug),
  };
}

function watchNudges(runDir: string, publish: (note: string, actor: string) => void): FSWatcher {
  const nudgesDir = join(runDir, "nudges");
  const seen = new Set<string>();
  return watch(nudgesDir, () => {
    void readdir(nudgesDir).then(async (entries) => {
      for (const entry of entries.filter((name) => name.endsWith(".json") && !seen.has(name)).sort()) {
        seen.add(entry);
        const parsed: unknown = JSON.parse(await readFile(join(nudgesDir, entry), "utf8"));
        if (typeof parsed === "object" && parsed !== null && "note" in parsed && typeof parsed.note === "string") {
          publish(parsed.note, "actor" in parsed && typeof parsed.actor === "string" ? parsed.actor : "operator");
        }
      }
    });
  });
}

export async function startRun(input: StartRunInput): Promise<RunningFactory> {
  const startedAt = input.now();
  const runId = runIdOf(input.slug, startedAt);
  const paths = runPaths(input.repoRoot, runId, input.slug, input.specPath, input.outDir);
  await mkdir(paths.handoffsDir, { recursive: true });
  await mkdir(paths.traceDir, { recursive: true });
  await mkdir(join(paths.runDir, "nudges"), { recursive: true });

  const redact = createRedactor(input.env);
  const runtime = createFactoryRuntime(runId, { redactPayload: (payload) => redactDeep(payload, redact) });
  let resolveTerminal: (outcome: TerminalOutcome) => void = () => undefined;
  const terminal = new Promise<TerminalOutcome>((resolvePromise) => {
    resolveTerminal = resolvePromise;
  });
  const context: SliceContext = {
    config: input.config,
    runId,
    slug: input.slug,
    operator: input.operator,
    push: input.push,
    paths,
    runtime,
    apiRoles: input.roleRunners?.apiRoles ?? createApiRoleRunner(runtime, input.config.pricing),
    cliRoles: input.roleRunners?.cliRoles ?? createCliRoleRunner(),
    prompts: createPromptLibrary(join(input.repoRoot, "prompts")),
    log: input.log,
    now: input.now,
  };
  const factorySlice = createFactorySlice({
    commandRunner: input.commandRunner,
    versions: input.versions,
    specPath: input.specPath,
    startedAt: startedAt.toISOString(),
    onTerminal: (outcome) => resolveTerminal(outcome),
  });
  const slices: Slice[] = [factorySlice, ...input.stageSlices].map((factory) => factory(context));
  const engine = new RunEngine({
    initialState: createRunState({ runId, slug: input.slug, operator: input.operator, startedAt: startedAt.toISOString() }),
    rules: composeRules(slices),
    store: new AtomicJsonStore(join(paths.runDir, "state.json")),
    publisher: runtime.publisher,
    effects: composeEffectRunner(slices, context),
    log: input.log,
  });
  const consume = (event: DeliveredEvent<EventType>): void => {
    engine.consume(event).catch((error: unknown) => {
      engine.fail(null, "runtime_error", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    });
  };
  const foreman = createReactor("foreman", Object.fromEntries(EVENT_TYPES.map((type) => [type, consume])));
  runtime.join(foreman);
  for (const slice of slices) {
    for (const participant of slice.participants(context)) {
      runtime.join(participant);
    }
  }
  const onUnhandled = (error: unknown): void => {
    engine.fail(null, "runtime_error", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  };
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);
  const watcher = watchNudges(paths.runDir, (note, actor) => {
    runtime.publisher.publish({ type: "human.intervention", producer: "foreman", payload: { kind: "mid_run_nudge", note, actor } });
  });

  runtime.publisher.publish({ type: "run.started", producer: "foreman", payload: { specPath: input.specPath, slug: input.slug, operator: input.operator, mode: "autonomous" } });

  return {
    runId,
    paths,
    terminal,
    async shutdown() {
      watcher.close();
      process.off("unhandledRejection", onUnhandled);
      process.off("uncaughtException", onUnhandled);
      for (const slice of slices) {
        if (slice.shutdown !== undefined) {
          await slice.shutdown();
        }
      }
    },
  };
}
