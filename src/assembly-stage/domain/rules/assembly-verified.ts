import type { TransitionResult, TransitionRule } from "../../../bus/domain/transition.js";
import type { RunState } from "../../../bus/domain/run-state.js";
import { tasksCovering, uniqueSorted } from "../attribution.js";
import { ASSEMBLY_EFFECT } from "../effects.js";
import { stringArrayField, stringField } from "../payload.js";
import { ASSEMBLY_RED } from "../rework-reasons.js";
import type { AssemblyRuleDeps } from "./deps.js";
import { failedRun, recordEffect, reworkEvents, unchanged } from "./emit.js";

function attributedRework(state: RunState, round: number, taskIds: readonly string[], evidencePath: string): TransitionResult {
  return {
    state: { ...state, status: "building" },
    emits: taskIds.flatMap((taskId) => reworkEvents({ state, round, taskId, target: "implementer", reason: ASSEMBLY_RED, findingPath: evidencePath })),
    effects: [recordEffect({ reworks: taskIds.map((task_id) => ({ round, task_id, target: "implementer", source: "attribution" })) })],
  };
}

export function assemblyVerifiedRule(deps: AssemblyRuleDeps): TransitionRule {
  return {
    name: "assembly.verified -> publish | rework | triage | failed",
    eventType: "assembly.verified",
    acceptsRunStatus: ["assembling"],
    apply({ state, event }) {
      const round = state.stageAttempts.assemblyRounds;
      const result = stringField(event.payload, "result");
      const step = stringField(event.payload, "step");
      const evidencePath = stringField(event.payload, "evidencePath");
      const failingCovers = stringArrayField(event.payload, "failingCovers");
      if (result === "green") {
        return step === "sdd_ready" ? { state: { ...state, status: "publishing" }, emits: [], effects: [{ kind: ASSEMBLY_EFFECT.publish }] } : unchanged(state);
      }
      if (round >= deps.assemblyRoundsCap) {
        return failedRun(state, "cap_exhausted", `round ${round}`);
      }
      const building: RunState = { ...state, status: "building" };
      if (step === "test") {
        const owners = failingCovers.map((id) => tasksCovering(state.tasks, id));
        if (owners.length > 0 && owners.every((ids) => ids.length > 0)) {
          return attributedRework(state, round, uniqueSorted(owners.flat()), evidencePath);
        }
      }
      if (step === "sdd_ready") {
        return { state: building, emits: [], effects: [{ kind: ASSEMBLY_EFFECT.routeSddReady, round, evidencePath }] };
      }
      if (step === "build") {
        return { state: building, emits: [], effects: [{ kind: ASSEMBLY_EFFECT.routeBuild, round, evidencePath }] };
      }
      return { state: building, emits: [], effects: [{ kind: ASSEMBLY_EFFECT.triage, round, step, evidencePath }] };
    },
  };
}
