import type { Effect } from "../bus/domain/transition.js";
import type { EffectContext } from "../bus/ports/outbound/effect-runner.js";
import type { SliceContext, SliceFactory } from "../shared/slice.js";
import { createExecFileCommandRunner } from "./adapters/outbound/exec-file-command-runner.js";
import { runArchitectEffect } from "./application/architect-effect.js";
import { runPlanEffect } from "./application/plan-effect.js";
import { runVerificationEffect } from "./application/verification-effect.js";
import { createDesignRules } from "./domain/rules.js";
import type { CommandRunner } from "./ports/outbound/command-runner.js";

export interface DesignStageDeps {
  readonly commands: CommandRunner;
}

export function createDesignStageSlice(deps: Partial<DesignStageDeps> = {}): SliceFactory {
  const commands = deps.commands ?? createExecFileCommandRunner();
  return (context: SliceContext) => ({
    name: "design-stage",
    rules: createDesignRules({ caps: context.config.caps, worktreesDir: context.paths.worktreesDir }),
    effects: {
      "design.architect": (effect: Effect, effectContext: EffectContext, slice: SliceContext) => runArchitectEffect(effect, effectContext, slice),
      "design.verification": (effect: Effect, effectContext: EffectContext, slice: SliceContext) => runVerificationEffect(effect, effectContext, slice, commands),
      "design.plan": (effect: Effect, effectContext: EffectContext, slice: SliceContext) => runPlanEffect(effect, effectContext, slice, commands),
    },
    participants: () => [],
  });
}
