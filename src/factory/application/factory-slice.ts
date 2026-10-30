import { join } from "node:path";
import { stageOf, type RunStage } from "../../bus/domain/run-state.js";
import { SIMPLE_FIX_RULE } from "../../bus/domain/simple-fix-rule.js";
import type { Effect, TransitionRule } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { writeTextAtomic } from "../../shared/fs/text.js";
import type { Slice, SliceContext, SliceFactory } from "../../shared/slice.js";
import { createRunManifest, type RunManifest } from "../domain/run-manifest.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { bootstrapProduct, BootstrapError } from "./bootstrap.js";
import type { ToolchainVersions } from "./product-scaffold.js";

export interface TerminalOutcome {
  readonly manifest: RunManifest;
  readonly evidencePath: string;
  readonly failureDetail: string | null;
}

export interface FactorySliceOptions {
  readonly commandRunner: CommandRunner;
  readonly versions: ToolchainVersions;
  readonly specPath: string;
  readonly startedAt: string;
  readonly onTerminal: (outcome: TerminalOutcome) => void;
  readonly resumedFrom: string | null;
}

export const BOOTSTRAP_EFFECT = "factory.bootstrap";
export const MANIFEST_EFFECT = "factory.manifest";
const FINALIZE_EFFECT = "factory.finalize";

function stringField(effect: Effect | Record<string, unknown>, key: string): string {
  const value = effect[key];
  return typeof value === "string" ? value : "";
}

function failureStage(stage: unknown): RunStage {
  return stage === "workspace" || stage === "spec" || stage === "design" || stage === "build" || stage === "assembly" || stage === "publish" ? stage : "workspace";
}

export function createFactorySlice(options: FactorySliceOptions): SliceFactory {
  return (context: SliceContext): Slice => {
    const manifestPath = join(context.paths.runDir, "run.json");
    let manifest = createRunManifest({ runId: context.runId, slug: context.slug, specPath: options.specPath, operator: context.operator, startedAt: options.startedAt, resumedFrom: options.resumedFrom });

    const persistManifest = async (next: RunManifest): Promise<void> => {
      manifest = next;
      await writeTextAtomic(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    };

    const rules: readonly TransitionRule[] = [
      {
        name: "run.started -> workspace",
        eventType: "run.started",
        apply: ({ state }) =>
          /* factory:BEH-009: a resumed run arrives with a seeded state; run.started is then recorded and the manifest written, nothing else. */
          state.status === "started"
            ? {
                state: { ...state, status: "workspace" },
                emits: [{ type: "human.intervention", producer: "foreman", payload: { kind: "launch", note: `run launched; approvals pre-authorised by ${state.operator}`, actor: state.operator } }],
                effects: [{ kind: BOOTSTRAP_EFFECT }],
              }
            : { state, emits: [], effects: [{ kind: MANIFEST_EFFECT }] },
      },
      {
        name: "human.intervention recorded",
        eventType: "human.intervention",
        apply: ({ state }) => ({ state, emits: [], effects: [] }),
      },
      SIMPLE_FIX_RULE,
      {
        name: "run.failed -> failed",
        eventType: "run.failed",
        apply: ({ state, event }) => ({
          state: {
            ...state,
            status: "failed",
            failure: { stage: failureStage(event.payload["stage"]), reason: stringField(event.payload, "reason"), detail: stringField(event.payload, "detail") },
          },
          emits: [],
          effects: [{ kind: FINALIZE_EFFECT, outcome: "failed", stage: stringField(event.payload, "stage"), reason: stringField(event.payload, "reason"), detail: stringField(event.payload, "detail") }],
        }),
      },
      {
        name: "run.published -> published",
        eventType: "run.published",
        apply: ({ state, event }) => ({
          state: { ...state, status: "published" },
          emits: [],
          effects: [
            {
              kind: FINALIZE_EFFECT,
              outcome: "published",
              commitSha: stringField(event.payload, "commitSha"),
              outputDir: stringField(event.payload, "outputDir"),
              pushed: event.payload["pushed"] === true,
            },
          ],
        }),
      },
    ];

    const effects = {
      [BOOTSTRAP_EFFECT]: async (_effect: Effect, effectContext: EffectContext): Promise<void> => {
        await persistManifest({ ...manifest, stage: "workspace" });
        try {
          const outcome = await bootstrapProduct({
            productDir: context.paths.productDir,
            slug: context.slug,
            date: options.startedAt.slice(0, 10),
            versions: options.versions,
            runner: options.commandRunner,
            installTimeoutMs: context.config.timeouts.verifierMs,
          });
          effectContext.publish({ type: "workspace.ready", producer: "foreman", payload: { productDir: context.paths.productDir, slug: context.slug, baselineId: outcome.baselineId } });
        } catch (error) {
          const reason = error instanceof BootstrapError && error.reason === "toolchain_install_failed" ? "tooling_broken" : "runtime_error";
          effectContext.publish({ type: "run.failed", producer: "foreman", payload: { stage: "workspace", reason, detail: error instanceof Error ? error.message : String(error) } });
        }
      },
      [MANIFEST_EFFECT]: async (_effect: Effect, effectContext: EffectContext): Promise<void> => {
        await persistManifest({ ...manifest, stage: stageOf(effectContext.state.status, effectContext.state.failure) });
      },
      [FINALIZE_EFFECT]: async (effect: Effect, effectContext: EffectContext): Promise<void> => {
        const state = effectContext.state;
        const tasks = Object.values(state.tasks);
        const counters = {
          tasks: tasks.length,
          tasksApproved: tasks.filter((task) => task.status === "approved").length,
          tasksFailed: tasks.filter((task) => task.status === "failed").length,
          reworks: tasks.reduce((sum, task) => sum + Math.max(0, task.attempts.implementer - 1) + Math.max(0, task.attempts.testWriter - 1), 0),
        };
        const endedAt = context.now().toISOString();
        const next: RunManifest =
          effect["outcome"] === "published"
            ? { ...manifest, status: "published", stage: "publish", endedAt, commitSha: stringField(effect, "commitSha"), outputDir: stringField(effect, "outputDir"), pushed: effect["pushed"] === true, counters }
            : { ...manifest, status: "failed", stage: stageOf(state.status, state.failure), endedAt, reason: stringField(effect, "reason"), counters };
        await persistManifest(next);
        options.onTerminal({ manifest: next, evidencePath: join(context.paths.runDir, "state.json"), failureDetail: state.failure === null ? null : state.failure.detail });
      },
    };

    return {
      name: "factory",
      rules,
      effects,
      participants: () => [],
    };
  };
}
