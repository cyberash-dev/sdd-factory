import type { RunState } from "../../../bus/domain/run-state.js";
import type { TransitionRule } from "../../../bus/domain/transition.js";
import { PayloadShapeError, nullableStringField, stringField } from "../payload.js";
import { TRIAGE, WRITE_SET_CONFLICT } from "../rework-reasons.js";
import type { AssemblyRuleDeps } from "./deps.js";
import { isReworkTarget } from "../ledger.js";
import { failedRun, recordEffect, reworkEvents } from "./emit.js";

export function assemblyTriagedRule(deps: AssemblyRuleDeps): TransitionRule {
  return {
    name: "assembly.triaged -> rework | failed",
    eventType: "assembly.triaged",
    acceptsRunStatus: ["assembling", "building"],
    apply({ state, event }) {
      const round = state.stageAttempts.assemblyRounds;
      const taskId = nullableStringField(event.payload, "taskId");
      const target = event.payload["target"];
      const reason = stringField(event.payload, "reason");
      if (!isReworkTarget(target)) {
        throw new PayloadShapeError("payload.target: expected an assembly target");
      }
      const triage = [{ round, task_id: taskId, target, reason }];
      if (round >= deps.assemblyRoundsCap) {
        return failedRun(state, "cap_exhausted", `round ${round}`, triage);
      }
      if (taskId === null) {
        return {
          state: { ...state, status: "building" },
          emits: [{ type: "design.rework", producer: "foreman", payload: { target: "planner", reason, attempt: designReworkAttempt(state), originTaskId: null } }],
          effects: [recordEffect({ triage })],
        };
      }
      const isConflict = reason === WRITE_SET_CONFLICT;
      return {
        state: { ...state, status: "building" },
        emits: reworkEvents({ state, round, taskId, target, reason: isConflict ? WRITE_SET_CONFLICT : TRIAGE, findingPath: isConflict ? null : deps.triageHandoffPath }),
        effects: [recordEffect({ triage, reworks: [{ round, task_id: taskId, target, source: "triage" }] })],
      };
    },
  };
}

/* Mirrors build-stage designReworkAttempt: bus:CTR-004 dedupes design.rework on attempt alone, so the ordinal spans both design roles. */
function designReworkAttempt(state: RunState): number {
  return state.stageAttempts.plannerRecuts + state.stageAttempts.architectRepairs + 1;
}
