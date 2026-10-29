import type { TransitionRule } from "../../../bus/domain/transition.js";
import { ASSEMBLY_EFFECT } from "../effects.js";
import { stringArrayField } from "../payload.js";

export function assemblyStartedRule(): TransitionRule {
  return {
    name: "assembly.started -> assembling",
    eventType: "assembly.started",
    acceptsRunStatus: ["building"],
    apply({ state, event }) {
      const round = state.stageAttempts.assemblyRounds + 1;
      const taskOrder = stringArrayField(event.payload, "taskOrder");
      return {
        state: { ...state, status: "assembling", stageAttempts: { ...state.stageAttempts, assemblyRounds: round } },
        emits: [],
        effects: [{ kind: ASSEMBLY_EFFECT.verify, round, taskOrder }],
      };
    },
  };
}
