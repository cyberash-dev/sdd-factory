import type { EffectHandler, SliceFactory } from "../shared/slice.js";
import { createExecFileCommandRunner } from "./adapters/exec-file-command-runner.js";
import { runApprove } from "./application/approve.js";
import { runAssume } from "./application/assume.js";
import { runAssumeFindings } from "./application/assume-findings.js";
import { runDraft } from "./application/draft.js";
import { runReview } from "./application/review.js";
import { createStageClock } from "./application/stage-clock.js";
import type { StageDeps } from "./application/stage-deps.js";
import { specStageRules } from "./domain/rules.js";
import { SPEC_EFFECT_KINDS } from "./effect-kinds.js";
import type { CommandRunner } from "./ports/command-runner.js";

export { DESIGN_EFFECT_KINDS, SPEC_EFFECT_KINDS } from "./effect-kinds.js";
export type { CommandResult, CommandRunner } from "./ports/command-runner.js";

export interface SpecStageOptions {
  readonly commands?: CommandRunner;
}

type StageHandler = (effect: Parameters<EffectHandler>[0], context: Parameters<EffectHandler>[1], slice: Parameters<EffectHandler>[2], deps: StageDeps) => Promise<void>;

function withDeps(handler: StageHandler, deps: StageDeps): EffectHandler {
  return (effect, context, slice) => handler(effect, context, slice, deps);
}

export function createSpecStageSlice(options: SpecStageOptions = {}): SliceFactory {
  const commands = options.commands ?? createExecFileCommandRunner();
  return (context) => {
    const deps: StageDeps = { commands, clock: createStageClock() };
    return {
      name: "spec-stage",
      rules: specStageRules(context.config.caps),
      effects: {
        [SPEC_EFFECT_KINDS.draft]: withDeps(runDraft, deps),
        [SPEC_EFFECT_KINDS.review]: withDeps(runReview, deps),
        [SPEC_EFFECT_KINDS.approve]: withDeps(runApprove, deps),
        [SPEC_EFFECT_KINDS.assume]: withDeps(runAssume, deps),
        [SPEC_EFFECT_KINDS.assumeFindings]: withDeps(runAssumeFindings, deps),
      },
      participants: () => [],
    };
  };
}
