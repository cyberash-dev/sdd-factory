import type { Caps } from "../../shared/config.js";
import type { PendingEvent, TransitionRule } from "../../bus/domain/transition.js";
import { DESIGN_EFFECT_KINDS, SPEC_EFFECT_KINDS } from "../effect-kinds.js";

function integerField(payload: Readonly<Record<string, unknown>>, field: string): number {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`payload.${field} must be an integer`);
  }
  return value;
}

function stringField(payload: Readonly<Record<string, unknown>>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string") {
    throw new Error(`payload.${field} must be a string`);
  }
  return value;
}

export function specStageRules(caps: Caps): readonly TransitionRule[] {
  return [
    {
      name: "workspace.ready -> spec_drafting",
      eventType: "workspace.ready",
      acceptsRunStatus: ["workspace"],
      apply: ({ state }) => ({ state: { ...state, status: "spec_drafting" }, emits: [], effects: [{ kind: SPEC_EFFECT_KINDS.draft, attempt: 1, reworkFinding: null }] }),
    },
    {
      name: "spec.drafted -> spec_review",
      eventType: "spec.drafted",
      acceptsRunStatus: ["spec_drafting"],
      apply: ({ state }) => {
        const round = state.stageAttempts.criticRounds + 1;
        return {
          state: { ...state, status: "spec_review", stageAttempts: { ...state.stageAttempts, criticRounds: round } },
          emits: [],
          effects: [{ kind: SPEC_EFFECT_KINDS.review, round }],
        };
      },
    },
    {
      name: "spec.reviewed -> approve | rework | critic_cap",
      eventType: "spec.reviewed",
      acceptsRunStatus: ["spec_review"],
      apply: ({ state, event }) => {
        const round = integerField(event.payload, "round");
        const findingsPath = stringField(event.payload, "findingsPath");
        if (stringField(event.payload, "decision") === "accept") {
          return { state, emits: [], effects: [{ kind: SPEC_EFFECT_KINDS.approve }] };
        }
        /* spec-stage:DLT-001: the final round never ends the run; its open findings become sandbox assumptions. */
        if (round >= caps.criticRounds) {
          return { state, emits: [], effects: [{ kind: SPEC_EFFECT_KINDS.assumeFindings, round, findingsPath }] };
        }
        return {
          state: { ...state, status: "spec_drafting" },
          emits: [{ type: "spec.rework", producer: "foreman", payload: { round, findingsPath } }],
          effects: [{ kind: SPEC_EFFECT_KINDS.draft, attempt: round + 1, reworkFinding: findingsPath }],
        };
      },
    },
    {
      name: "spec.rework (bookkeeping)",
      eventType: "spec.rework",
      acceptsRunStatus: ["spec_drafting"],
      apply: ({ state }) => ({ state, emits: [], effects: [] }),
    },
    {
      name: "spec.approved -> spec_approved",
      eventType: "spec.approved",
      acceptsRunStatus: ["spec_review"],
      apply: ({ state }) => ({
        state: { ...state, status: "spec_approved" },
        emits: [],
        effects: [
          { kind: DESIGN_EFFECT_KINDS.architect, attempt: 1 },
          { kind: DESIGN_EFFECT_KINDS.verification, attempt: 1 },
        ],
      }),
    },
    {
      name: "spec.blocked -> run.failed",
      eventType: "spec.blocked",
      acceptsRunStatus: ["spec_drafting", "spec_review"],
      apply: ({ state, event }) => {
        const reason = stringField(event.payload, "reason");
        const detail = stringField(event.payload, "detail");
        return { state, emits: [{ type: "run.failed", producer: "foreman", payload: { stage: "spec", reason, detail } }], effects: [] };
      },
    },
  ];
}
