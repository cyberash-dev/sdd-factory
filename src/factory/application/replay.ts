import { join, resolve } from "node:path";
import { createFactoryRuntime } from "../../bus/adapters/mozaik/runtime.js";
import type { EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../bus/domain/envelope.js";
import { createRunState, stageOf, type RunState } from "../../bus/domain/run-state.js";
import { dedupeKey, reduce, type Effect, type PendingEvent, type ReduceOutcome, type TransitionRule } from "../../bus/domain/transition.js";
import type { FactoryConfig } from "../../shared/config.js";
import { createApiRoleRunner } from "../../shared/llm/api-role-runner.js";
import { createCliRoleRunner } from "../../shared/llm/cli-role-runner.js";
import { createPromptLibrary } from "../../shared/prompts.js";
import { createRedactor, redactDeep } from "../../shared/redaction.js";
import { composeEffectRunner, composeRules, type RunPaths, type Slice, type SliceContext, type SliceFactory } from "../../shared/slice.js";
import { UsageError, type ReplayTarget } from "../domain/argv.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { runPaths } from "./compose.js";
import { createFactorySlice } from "./factory-slice.js";
import type { ToolchainVersions } from "./product-scaffold.js";
import { planReplay, readResumeSource, ResumeError, type ResumeSource } from "./resume.js";

export interface ReplayInput {
  readonly repoRoot: string;
  readonly runId: string;
  readonly target: ReplayTarget;
  readonly config: FactoryConfig;
  readonly stageSlices: readonly SliceFactory[];
  readonly commandRunner: CommandRunner;
  readonly versions: ToolchainVersions;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ReplayOutcome {
  readonly replayed: DeliveredEvent<EventType>;
  readonly events: readonly PendingEvent[];
  readonly exitCode: 0 | 1;
}

interface ReplayRig {
  readonly slices: readonly Slice[];
  readonly rules: readonly TransitionRule[];
  readonly runEffect: (effect: Effect, state: RunState, publish: (pending: PendingEvent) => void) => Promise<void>;
}

/* factory:DLT-011 counts task.tests_rejected as a rejection, so the last word of the type decides, after a dot or an underscore. */
const FAILING_TYPE = /[._](failed|blocked|rejected)$/;

function usageErrorOf(error: unknown): unknown {
  return error instanceof ResumeError ? new UsageError(error.message) : error;
}

function asUsage<T>(body: () => T): T {
  try {
    return body();
  } catch (error) {
    throw usageErrorOf(error);
  }
}

/* factory:DLT-011: replay accepts the run as it is; any reason resume refuses it (unknown run, nothing to redo) is a usage error. */
async function sourceOf(repoRoot: string, runId: string): Promise<ResumeSource> {
  try {
    return await readResumeSource(repoRoot, runId, true);
  } catch (error) {
    throw usageErrorOf(error);
  }
}

function pathsOf(input: ReplayInput, source: ResumeSource): RunPaths {
  const own = runPaths(input.repoRoot, input.runId, source.manifest.slug, resolve(input.repoRoot, source.manifest.specPath), null);
  return { ...own, productDir: join(source.workDir, "product"), worktreesDir: join(source.workDir, "worktrees"), handoffsDir: join(source.workDir, "handoffs") };
}

/* No participant joins the runtime: the tracer and the cloud mirror never see an event, and the factory slice's effects (run.json, bootstrap) are skipped. */
function rigOf(input: ReplayInput, source: ResumeSource): ReplayRig {
  const runtime = createFactoryRuntime(input.runId);
  const context: SliceContext = {
    config: input.config,
    runId: input.runId,
    slug: source.manifest.slug,
    operator: source.manifest.operator,
    push: false,
    paths: pathsOf(input, source),
    runtime,
    apiRoles: createApiRoleRunner(runtime, input.config.pricing, input.config.models.effort),
    cliRoles: createCliRoleRunner(),
    prompts: createPromptLibrary(join(input.repoRoot, "prompts")),
    log: input.log,
    now: input.now,
  };
  const factorySlice = createFactorySlice({
    commandRunner: input.commandRunner,
    versions: input.versions,
    specPath: context.paths.specSourcePath,
    startedAt: source.manifest.startedAt,
    onTerminal: () => undefined,
    resumedFrom: source.manifest.resumedFrom,
  })(context);
  const stageSlices = input.stageSlices.map((factory) => factory(context));
  const effects = composeEffectRunner(stageSlices, context);
  return {
    slices: stageSlices,
    rules: composeRules([factorySlice, ...stageSlices]),
    runEffect: async (effect, state, publish) => {
      if (Object.hasOwn(factorySlice.effects, effect.kind)) {
        input.log(`effect ${effect.kind} not replayed: it belongs to the run's own lifecycle`);
        return;
      }
      await effects.run(effect, { state, publish });
    },
  };
}

function initialStateOf(source: ResumeSource): RunState {
  return createRunState({ runId: source.manifest.runId, slug: source.manifest.slug, operator: source.manifest.operator, startedAt: source.manifest.startedAt });
}

function targetIndexOf(input: ReplayInput, rules: readonly TransitionRule[], source: ResumeSource): number {
  const target = input.target;
  if (target.kind === "last") {
    const first = asUsage(() => planReplay(rules, initialStateOf(source), source.events)).redo[0];
    return first === undefined ? -1 : source.events.indexOf(first);
  }
  const index = source.events.findIndex((event) => event.runId === input.runId && event.seq === target.seq);
  if (index === -1) {
    throw new UsageError(`run ${input.runId} has no event with seq ${target.seq}`);
  }
  return index;
}

/* The target event reduced against the state its own history leaves before it, exactly as the foreman reduced it then. */
function outcomeAt(rules: readonly TransitionRule[], source: ResumeSource, index: number): ReduceOutcome {
  let state = initialStateOf(source);
  const consumed = new Set<string>();
  for (const event of source.events.slice(0, index)) {
    const outcome = reduce(rules, state, event, consumed);
    const key = dedupeKey(event);
    if (key !== null) {
      consumed.add(key);
    }
    if (outcome.kind === "applied") {
      state = outcome.result.state;
    }
  }
  const target = source.events[index];
  if (target === undefined) {
    throw new UsageError(`run ${source.manifest.runId}: nothing to replay`);
  }
  return reduce(rules, state, target, consumed);
}

/* An effect that throws would make the foreman publish run.failed{runtime_error}; the replay prints that event instead. */
async function effectsPublished(rig: ReplayRig, outcome: Extract<ReduceOutcome, { kind: "applied" }>): Promise<readonly PendingEvent[]> {
  const published: PendingEvent[] = [...outcome.result.emits];
  const state = outcome.result.state;
  await Promise.all(
    outcome.result.effects.map(async (effect) => {
      try {
        await rig.runEffect(effect, state, (pending) => published.push(pending));
      } catch (error) {
        const detail = `effect ${effect.kind}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
        published.push({ type: "run.failed", producer: "foreman", payload: { stage: stageOf(state.status, state.failure), reason: "runtime_error", detail } });
      }
    }),
  );
  return published;
}

export function replayExitCode(events: readonly PendingEvent[]): 0 | 1 {
  return events.some((event) => FAILING_TYPE.test(event.type)) ? 1 : 0;
}

export function replayLine(event: PendingEvent): string {
  return `${JSON.stringify({ type: event.type, producer: event.producer, payload: event.payload })}\n`;
}

/* factory:DLT-011: rebuilds the state before one recorded event, runs its effects for real and collects what they would publish. */
export async function replayEvent(input: ReplayInput): Promise<ReplayOutcome> {
  const source = await sourceOf(input.repoRoot, input.runId);
  const rig = rigOf(input, source);
  try {
    const index = targetIndexOf(input, rig.rules, source);
    const replayed = source.events[index];
    if (replayed === undefined) {
      throw new UsageError(`run ${input.runId}: nothing to replay`);
    }
    const outcome = outcomeAt(rig.rules, source, index);
    if (outcome.kind !== "applied") {
      input.log(`${outcome.kind} ${replayed.type} seq=${replayed.seq}`);
      return { replayed, events: [], exitCode: 0 };
    }
    input.log(`replaying ${outcome.rule} ${replayed.type} seq=${replayed.seq}`);
    const redact = createRedactor(input.env);
    const events = (await effectsPublished(rig, outcome)).map((event) => ({ ...event, payload: redactDeep(event.payload, redact) }));
    return { replayed, events, exitCode: replayExitCode(events) };
  } finally {
    for (const slice of rig.slices) {
      await slice.shutdown?.();
    }
  }
}
