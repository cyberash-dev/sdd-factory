import { join } from "node:path";
import type { SliceFactory } from "../shared/slice.js";
import { createExecFileCommandRunner } from "./adapters/outbound/exec-file-command-runner.js";
import { publishEffect } from "./application/publish.js";
import { recordEffect } from "./application/record.js";
import { routeBuildEffect } from "./application/route-build.js";
import { routeSddReadyEffect } from "./application/route-sdd-ready.js";
import { startEffect } from "./application/start.js";
import { TRIAGE_HANDOFF, triageEffect } from "./application/triage.js";
import { verifyEffect } from "./application/verify.js";
import { ASSEMBLY_EFFECT } from "./domain/effects.js";
import { assemblyReworkRule } from "./domain/rules/assembly-rework.js";
import { assemblyStartedRule } from "./domain/rules/assembly-started.js";
import { assemblyTriagedRule } from "./domain/rules/assembly-triaged.js";
import { assemblyVerifiedRule } from "./domain/rules/assembly-verified.js";
import type { CommandRunner } from "./ports/outbound/command-runner.js";

export interface AssemblySliceOptions {
  readonly commandRunner?: CommandRunner;
}

export function createAssemblySlice(options: AssemblySliceOptions = {}): SliceFactory {
  const runner = options.commandRunner ?? createExecFileCommandRunner();
  return (context) => {
    const deps = { assemblyRoundsCap: context.config.caps.assemblyRounds, triageHandoffPath: join(context.paths.handoffsDir, TRIAGE_HANDOFF) };
    const triage = triageEffect(runner);
    return {
      name: "assembly-stage",
      rules: [assemblyStartedRule(), assemblyVerifiedRule(deps), assemblyTriagedRule(deps), assemblyReworkRule()],
      effects: {
        [ASSEMBLY_EFFECT.start]: startEffect(),
        [ASSEMBLY_EFFECT.verify]: verifyEffect(runner),
        [ASSEMBLY_EFFECT.triage]: triage,
        [ASSEMBLY_EFFECT.routeSddReady]: routeSddReadyEffect(triage),
        [ASSEMBLY_EFFECT.routeBuild]: routeBuildEffect(triage),
        [ASSEMBLY_EFFECT.publish]: publishEffect(runner),
        [ASSEMBLY_EFFECT.record]: recordEffect(),
      },
      participants: () => [],
    };
  };
}

export { ASSEMBLY_EFFECT } from "./domain/effects.js";
export { allTasksApproved, topologicalTaskOrder } from "./domain/task-order.js";
export type { CommandInvocation, CommandResult, CommandRunner } from "./ports/outbound/command-runner.js";
