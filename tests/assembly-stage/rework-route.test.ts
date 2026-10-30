import { describe, expect, it } from "vitest";
import { assemblyTriagedRule } from "../../src/assembly-stage/domain/rules/assembly-triaged.js";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import { reduce } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { delivered, runState, taskState } from "./support.js";

const IMPL_SHA = "3333333333333333333333333333333333333333";
const buildRules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });

function forwardedRework(emits: readonly PendingEvent[]): PendingEvent {
  const rework = emits.find((event) => event.type === "task.rework");
  if (rework === undefined) {
    throw new Error(`no task.rework among ${JSON.stringify(emits)}`);
  }
  return rework;
}

describe("assembly route of an approved task back into its lane", () => {
  // @covers build-stage:DLT-008
  // @covers assembly-stage:BEH-005
  it("applies the forwarded task.rework to the approved task and runs its implementer", () => {
    const state = runState({ status: "assembling", assemblyRounds: 1, tasks: { "T-001": taskState({ status: "approved", implSha: IMPL_SHA, implementerAttempts: 1 }) } });
    const triaged = assemblyTriagedRule({ assemblyRoundsCap: 2, triageHandoffPath: "/run/handoffs/triage/handoff.md" }).apply({ state, event: delivered("assembly.triaged", { taskId: "T-001", target: "implementer", reason: "missing export" }) });
    const rework = forwardedRework(triaged.emits);

    const outcome = reduce(buildRules, triaged.state, delivered(rework.type, rework.payload, 2), new Set());

    expect(outcome.kind === "applied" ? [outcome.result.state.tasks["T-001"]?.status, outcome.result.effects] : outcome.kind).toEqual([
      "impl_pending",
      [{ kind: "build.implementer", taskId: "T-001", attempt: 2, reworkFinding: { reason: "triage", findingPath: "/run/handoffs/triage/handoff.md" } }],
    ]);
  });
});
