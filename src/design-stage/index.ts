import { setTimeout as sleep } from "node:timers/promises";
import type { Effect } from "../bus/domain/transition.js";
import type { EffectContext } from "../bus/ports/outbound/effect-runner.js";
import type { SliceContext, SliceFactory } from "../shared/slice.js";
import { createGitWorkingTree, type SimpleFixDeps } from "../shared/fixer/index.js";
import { createExecFileCommandRunner } from "./adapters/outbound/exec-file-command-runner.js";
import { createExecFileProcessRunner } from "./adapters/outbound/exec-file-process-runner.js";
import { runArchitectEffect } from "./application/architect-effect.js";
import { runPlanEffect } from "./application/plan-effect.js";
import { runVerificationEffect } from "./application/verification-effect.js";
import { createDesignRules } from "./domain/rules.js";
import type { CommandRunner } from "./ports/outbound/command-runner.js";

export interface DesignStageDeps {
  readonly commands: CommandRunner;
  readonly fix: SimpleFixDeps;
}

export function createDesignStageSlice(deps: Partial<DesignStageDeps> = {}): SliceFactory {
  const commands = deps.commands ?? createExecFileCommandRunner();
  const fix = deps.fix ?? { tree: createGitWorkingTree(createExecFileProcessRunner()), delay: async (ms: number): Promise<void> => sleep(ms) };
  return (context: SliceContext) => ({
    name: "design-stage",
    rules: createDesignRules({ caps: context.config.caps, worktreesDir: context.paths.worktreesDir }),
    effects: {
      "design.architect": (effect: Effect, effectContext: EffectContext, slice: SliceContext) => runArchitectEffect(effect, effectContext, slice, fix),
      "design.verification": (effect: Effect, effectContext: EffectContext, slice: SliceContext) => runVerificationEffect(effect, effectContext, slice, commands, fix),
      "design.plan": (effect: Effect, effectContext: EffectContext, slice: SliceContext) => runPlanEffect(effect, effectContext, slice, commands, fix),
    },
    participants: () => [],
  });
}
