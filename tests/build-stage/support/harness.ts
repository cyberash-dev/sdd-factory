import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFactoryRuntime } from "../../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../../src/bus/application/run-engine.js";
import { validateEvent, type EventType } from "../../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../../src/bus/domain/envelope.js";
import type { RunState } from "../../../src/bus/domain/run-state.js";
import type { Effect, PendingEvent } from "../../../src/bus/domain/transition.js";
import type { EffectContext } from "../../../src/bus/ports/outbound/effect-runner.js";
import { createBuildStageSlice, type DesignBundle } from "../../../src/build-stage/index.js";
import type { DesignSource } from "../../../src/build-stage/ports/outbound/design-source.js";
import { DEFAULT_CONFIG, type FactoryConfig } from "../../../src/shared/config.js";
import type { ApiRoleRunner } from "../../../src/shared/llm/api-role-runner.js";
import type { CliRoleRunner } from "../../../src/shared/llm/cli-role-runner.js";
import { createPromptLibrary } from "../../../src/shared/prompts.js";
import { composeEffectRunner, type Slice, type SliceContext } from "../../../src/shared/slice.js";
import { REPO_ROOT } from "./product.js";
import { routingCommandRunner, scriptedApiRoles, scriptedCliRoles, type RoutingCommandRunner, type RoutingOptions } from "./runners.js";
import { RUN_ID } from "./state.js";

export interface HarnessOptions {
  readonly productDir: string;
  readonly design: DesignBundle;
  readonly designSource?: DesignSource;
  readonly cliRoles?: CliRoleRunner;
  readonly apiRoles?: ApiRoleRunner;
  readonly commands?: RoutingOptions;
  readonly config?: Partial<FactoryConfig>;
}

export interface LaneHarness {
  readonly context: SliceContext;
  readonly slice: Slice;
  readonly commands: RoutingCommandRunner;
  readonly logs: string[];
  readonly worktreeOf: (taskId: string) => string;
  effectContext(state: RunState, published: PendingEvent[]): EffectContext;
}

/* simpleFixes 0: lanes take the original failure path unless a test opts into the simple-fixer. */
export const TEST_CONFIG: FactoryConfig = {
  ...DEFAULT_CONFIG,
  caps: { ...DEFAULT_CONFIG.caps, simpleFixes: 0 },
  timeouts: { ...DEFAULT_CONFIG.timeouts, cliRoleMs: 10_000, apiRoleMs: 10_000, verifierMs: 60_000 },
};

export async function aLaneHarness(options: HarnessOptions): Promise<LaneHarness> {
  const runDir = await mkdtemp(join(tmpdir(), "sdd-run-"));
  const logs: string[] = [];
  const commands = routingCommandRunner(options.commands ?? {});
  const context: SliceContext = {
    config: { ...TEST_CONFIG, ...options.config },
    runId: RUN_ID,
    slug: "greeter",
    operator: "cyberash",
    push: false,
    paths: {
      repoRoot: REPO_ROOT,
      runDir,
      productDir: options.productDir,
      worktreesDir: join(runDir, "worktrees"),
      handoffsDir: join(runDir, "handoffs"),
      traceDir: join(runDir, "trace"),
      specSourcePath: join(REPO_ROOT, "spec.md"),
      outputDir: join(runDir, "out"),
    },
    runtime: createFactoryRuntime(RUN_ID),
    apiRoles: options.apiRoles ?? scriptedApiRoles(async () => undefined),
    cliRoles: options.cliRoles ?? scriptedCliRoles(() => undefined),
    prompts: createPromptLibrary(join(REPO_ROOT, "prompts")),
    log: (line) => {
      logs.push(line);
    },
    now: () => new Date("2026-10-29T12:00:00.000Z"),
  };
  const slice = createBuildStageSlice({ commands, design: options.designSource ?? { load: async () => options.design }, delay: async () => undefined })(context);
  return {
    context,
    slice,
    commands,
    logs,
    worktreeOf: (taskId) => join(runDir, "worktrees", taskId),
    effectContext: (state, published) => ({ state, publish: (pending) => published.push(pending) }),
  };
}

export interface LaneEngine {
  readonly events: DeliveredEvent<EventType>[];
  readonly foreignEffects: Effect[];
  readonly state: () => RunState;
  publish(pending: PendingEvent): void;
  runEffect(effect: Effect): Promise<void>;
  waitFor(predicate: (events: readonly DeliveredEvent<EventType>[]) => boolean, timeoutMs?: number): Promise<void>;
}

export function eventTypes(events: readonly DeliveredEvent<EventType>[]): readonly string[] {
  return events.map((event) => event.type);
}

export function hasEvent(type: EventType, match: (payload: DeliveredEvent<EventType>["payload"]) => boolean = () => true): (events: readonly DeliveredEvent<EventType>[]) => boolean {
  return (events) => events.some((event) => event.type === type && match(event.payload));
}

/* An in-memory bus: every published event is validated, sequenced and fed back into the engine. */
export function laneEngine(harness: LaneHarness, initialState: RunState): LaneEngine {
  const events: DeliveredEvent<EventType>[] = [];
  const waiters: { readonly predicate: (events: readonly DeliveredEvent<EventType>[]) => boolean; readonly resolve: () => void }[] = [];
  const failures: unknown[] = [];
  let seq = 0;
  const foreignEffects: Effect[] = [];
  const foreign: Slice = {
    name: "foreign",
    rules: [{ name: "run.failed -> failed", eventType: "run.failed", apply: ({ state }) => ({ state: { ...state, status: "failed" }, emits: [], effects: [] }) }],
    effects: {
      "assembly.start": async (effect) => {
        foreignEffects.push(effect);
      },
      "spec.assume": async (effect) => {
        foreignEffects.push(effect);
      },
    },
    participants: () => [],
  };
  const effects = composeEffectRunner([harness.slice, foreign], harness.context);
  const engine = new RunEngine({
    initialState,
    rules: [...harness.slice.rules, ...foreign.rules],
    store: { write: async () => undefined },
    publisher: {
      publish(pending: PendingEvent): DeliveredEvent<EventType> {
        const candidate = { ...pending, runId: RUN_ID, occurredAt: new Date().toISOString() };
        validateEvent(candidate);
        seq += 1;
        const delivered: DeliveredEvent<EventType> = { ...candidate, seq };
        events.push(delivered);
        const notify = (): void => {
          for (const waiter of [...waiters]) {
            if (waiter.predicate(events)) {
              waiters.splice(waiters.indexOf(waiter), 1);
              waiter.resolve();
            }
          }
        };
        engine.consume(delivered).then(notify, (error: unknown) => {
          failures.push(error);
          notify();
        });
        return delivered;
      },
    },
    effects,
    log: (line) => {
      harness.logs.push(line);
    },
  });
  return {
    events,
    foreignEffects,
    state: () => engine.state,
    publish: (pending) => {
      engine.publish(pending);
    },
    runEffect: (effect) => effects.run(effect, { state: engine.state, publish: (pending) => engine.publish(pending) }),
    waitFor: (predicate, timeoutMs = 15_000) =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        if (predicate(events)) {
          resolvePromise();
          return;
        }
        const timer = setTimeout(() => rejectPromise(new Error(`timed out; events: ${events.map((event) => event.type).join(", ")}; logs: ${harness.logs.slice(-5).join(" | ")}; failures: ${String(failures)}`)), timeoutMs);
        waiters.push({
          predicate,
          resolve: () => {
            clearTimeout(timer);
            resolvePromise();
          },
        });
      }),
  };
}
