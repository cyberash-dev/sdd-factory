import { setTimeout as sleep } from "node:timers/promises";
import type { Effect } from "../bus/domain/transition.js";
import type { EffectContext } from "../bus/ports/outbound/effect-runner.js";
import { signalLanes } from "../shared/llm/cli-role-runner.js";
import type { EffectHandler, SliceContext, SliceFactory } from "../shared/slice.js";
import { createExecFileCommandRunner } from "./adapters/outbound/exec-file-command-runner.js";
import { createFileDesignSource } from "./adapters/outbound/file-design-source.js";
import { createDesignCache } from "./application/design-cache.js";
import { runArbitrationFix } from "./application/effects/arbitration-fix.js";
import { runGreenCheck } from "./application/effects/green-check.js";
import { runImplementer } from "./application/effects/implementer.js";
import { runIntegrate } from "./application/effects/integrate.js";
import { runRedCheck } from "./application/effects/red-check.js";
import { reprovisionOriginOf, runReprovision } from "./application/effects/reprovision.js";
import { runRestartLane } from "./application/effects/restart-lane.js";
import { runReviewer } from "./application/effects/reviewer.js";
import { scheduleLanes, startLane } from "./application/effects/schedule.js";
import { runTerminateLanes } from "./application/effects/terminate-lanes.js";
import { runTestWriter } from "./application/effects/test-writer.js";
import { createGit } from "./application/git.js";
import type { LaneDeps } from "./application/lane-deps.js";
import { LaneRegistry } from "./application/lane-registry.js";
import type { ArbitrationFinding } from "./domain/lane-messages.js";
import { integerField, optionalStringsField, PayloadFieldError, stringField, stringOrNullField, stringsField } from "./domain/payload.js";
import { buildStageRules, type ReworkFinding } from "./domain/rules/index.js";
import { BUILD_EFFECT_KINDS } from "./effect-kinds.js";
import type { CommandRunner } from "./ports/outbound/command-runner.js";
import type { DesignSource } from "./ports/outbound/design-source.js";

export { BUILD_EFFECT_KINDS, FOREIGN_EFFECT_KINDS } from "./effect-kinds.js";
export type { CommandOptions, CommandResult, CommandRunner } from "./ports/outbound/command-runner.js";
export type { DesignBundle, DesignSource } from "./ports/outbound/design-source.js";
export { allTasksApproved, startableTasks } from "./domain/task-scheduling.js";

export interface BuildStageOptions {
  readonly commands?: CommandRunner;
  readonly design?: DesignSource;
  readonly delay?: (ms: number) => Promise<void>;
}

type LaneHandler = (slice: SliceContext, deps: LaneDeps, context: EffectContext, effect: Effect) => Promise<void>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reworkFindingOf(effect: Effect): ReworkFinding | null {
  const value = effect["reworkFinding"];
  return isRecord(value) ? { reason: stringField(value, "reason"), findingPath: stringOrNullField(value, "findingPath") } : null;
}

function requiredReworkFindingOf(effect: Effect): ReworkFinding {
  const finding = reworkFindingOf(effect);
  if (finding === null) {
    throw new PayloadFieldError("reworkFinding: expected an object");
  }
  return finding;
}

function arbitrationFindingOf(effect: Effect): ArbitrationFinding | null {
  const value = effect["finding"];
  return isRecord(value) ? { type: stringField(value, "type"), specIds: stringsField(value, "specIds"), detail: stringField(value, "detail") } : null;
}

const HANDLERS: Readonly<Record<string, LaneHandler>> = {
  [BUILD_EFFECT_KINDS.schedule]: (slice, deps, context, effect) => scheduleLanes(slice, deps, context, optionalStringsField(effect, "removedTaskIds")),
  [BUILD_EFFECT_KINDS.worktree]: async (slice, deps, context, effect) => startLane(slice, deps, context, await deps.design.load(), stringField(effect, "taskId")),
  [BUILD_EFFECT_KINDS.testWriter]: (slice, deps, context, effect) =>
    runTestWriter(slice, deps, context, { taskId: stringField(effect, "taskId"), attempt: integerField(effect, "attempt"), reworkFinding: reworkFindingOf(effect) }),
  [BUILD_EFFECT_KINDS.redCheck]: (slice, deps, context, effect) =>
    runRedCheck(slice, deps, context, { taskId: stringField(effect, "taskId"), attempt: integerField(effect, "attempt"), firewallViolations: optionalStringsField(effect, "firewallViolations") }),
  [BUILD_EFFECT_KINDS.implementer]: (slice, deps, context, effect) =>
    runImplementer(slice, deps, context, { taskId: stringField(effect, "taskId"), attempt: integerField(effect, "attempt"), reworkFinding: reworkFindingOf(effect) }),
  [BUILD_EFFECT_KINDS.greenCheck]: (slice, deps, context, effect) => runGreenCheck(slice, deps, context, { taskId: stringField(effect, "taskId"), attempt: integerField(effect, "attempt") }),
  [BUILD_EFFECT_KINDS.reviewer]: (slice, deps, context, effect) =>
    runReviewer(slice, deps, context, {
      taskId: stringField(effect, "taskId"),
      mode: stringField(effect, "mode") === "arbitration" ? "arbitration" : "review",
      attempt: integerField(effect, "attempt"),
      finding: arbitrationFindingOf(effect),
    }),
  [BUILD_EFFECT_KINDS.integrate]: (slice, deps, context, effect) =>
    runIntegrate(slice, deps, context, stringField(effect, "taskId"), Object.hasOwn(effect, "capReachedRole") ? stringField(effect, "capReachedRole") : null),
  [BUILD_EFFECT_KINDS.restartLane]: (slice, deps, context, effect) =>
    runRestartLane(slice, deps, context, {
      taskId: stringField(effect, "taskId"),
      attempt: integerField(effect, "attempt"),
      reworkFinding: reworkFindingOf(effect),
      frozenTestsSha: Object.hasOwn(effect, "frozenTestsSha") ? stringField(effect, "frozenTestsSha") : null,
    }),
  [BUILD_EFFECT_KINDS.arbitrationFix]: (slice, deps, context, effect) =>
    runArbitrationFix(slice, deps, context, { taskId: stringField(effect, "taskId"), frozenTestsSha: stringField(effect, "frozenTestsSha"), reworkFinding: requiredReworkFindingOf(effect) }),
  [BUILD_EFFECT_KINDS.terminateLanes]: (slice, deps) => runTerminateLanes(slice, deps),
  [BUILD_EFFECT_KINDS.reprovision]: (slice, deps, context, effect) =>
    runReprovision(slice, deps, context, { taskId: stringField(effect, "taskId"), origin: reprovisionOriginOf(effect["origin"]), attempt: integerField(effect, "attempt") }),
};

export function createBuildStageSlice(options: BuildStageOptions = {}): SliceFactory {
  const commands = options.commands ?? createExecFileCommandRunner();
  const source = options.design ?? createFileDesignSource();
  const delay = options.delay ?? ((ms: number): Promise<void> => sleep(ms));
  return (context) => {
    const deps: LaneDeps = { commands, git: createGit(commands), design: createDesignCache(source, context.paths.productDir), lanes: new LaneRegistry(), delay };
    const effects = Object.fromEntries(
      Object.entries(HANDLERS).map(([kind, handler]): [string, EffectHandler] => [kind, (effect, effectContext) => handler(context, deps, effectContext, effect)]),
    );
    return {
      name: "build-stage",
      rules: buildStageRules({ caps: context.config.caps, handoffsDir: context.paths.handoffsDir, laneModel: context.config.models.lane }),
      effects,
      participants: () => [],
      shutdown: async () => {
        deps.lanes.cancelAll();
        signalLanes("SIGTERM");
      },
    };
  };
}
