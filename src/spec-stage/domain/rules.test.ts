import { describe, expect, it } from "vitest";
import type { EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../bus/domain/envelope.js";
import { createRunState, type RunState } from "../../bus/domain/run-state.js";
import { reduce, type TransitionResult } from "../../bus/domain/transition.js";
import { DEFAULT_CONFIG } from "../../shared/config.js";
import { specStageRules } from "./rules.js";

const RUN_ID = "todo-cli-20261029-120000";

function stateAt(status: RunState["status"], criticRounds = 0): RunState {
  const base = createRunState({ runId: RUN_ID, slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
  return { ...base, status, stageAttempts: { ...base.stageAttempts, criticRounds } };
}

function delivered(type: EventType, payload: EventPayload): DeliveredEvent<EventType> {
  return { type, runId: RUN_ID, occurredAt: "2026-10-29T12:00:05.000Z", producer: "foreman", payload, seq: 5 };
}

function applied(state: RunState, type: EventType, payload: EventPayload): TransitionResult {
  const outcome = reduce(specStageRules(DEFAULT_CONFIG.caps), state, delivered(type, payload), new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

describe("spec-stage rules", () => {
  // @covers spec-stage:BEH-001
  it("starts the analyst with attempt 1 when the workspace is ready", () => {
    const result = applied(stateAt("workspace"), "workspace.ready", { productDir: "/p", slug: "todo-cli", baselineId: "todo-cli:BL-001" });

    expect([result.state.status, result.emits, result.effects]).toEqual(["spec_drafting", [], [{ kind: "spec.draft", attempt: 1, reworkFinding: null }]]);
  });

  // @covers spec-stage:BEH-002
  it("starts critic round 1 with a fresh invocation once the draft is lint-clean", () => {
    const result = applied(stateAt("spec_drafting"), "spec.drafted", { attempt: 1, lintExit: 0, recordCounts: { behaviors: 1 } });

    expect([result.state.status, result.state.stageAttempts.criticRounds, result.effects]).toEqual(["spec_review", 1, [{ kind: "spec.review", round: 1 }]]);
  });

  it("numbers the second critic round from the attempts counter", () => {
    const result = applied(stateAt("spec_drafting", 1), "spec.drafted", { attempt: 2, lintExit: 0, recordCounts: {} });

    expect(result.effects).toEqual([{ kind: "spec.review", round: 2 }]);
  });

  it("runs the pre-authorised approval when the critic accepts", () => {
    const result = applied(stateAt("spec_review", 1), "spec.reviewed", { round: 1, decision: "accept", findingsPath: "spec/review/ga.md" });

    expect([result.state.status, result.emits, result.effects]).toEqual(["spec_review", [], [{ kind: "spec.approve" }]]);
  });

  // @covers spec-stage:BEH-003
  it("routes rework in round 1 to the analyst as attempt 2 carrying the findings path", () => {
    const result = applied(stateAt("spec_review", 1), "spec.reviewed", { round: 1, decision: "rework", findingsPath: "spec/review/ga.md" });

    expect([result.state.status, result.emits, result.effects]).toEqual([
      "spec_drafting",
      [{ type: "spec.rework", producer: "foreman", payload: { round: 1, findingsPath: "spec/review/ga.md" } }],
      [{ kind: "spec.draft", attempt: 2, reworkFinding: "spec/review/ga.md" }],
    ]);
  });

  // @covers spec-stage:CST-002
  it("blocks the run with critic_cap instead of a third draft when round 2 answers rework", () => {
    const result = applied(stateAt("spec_review", 2), "spec.reviewed", { round: 2, decision: "rework", findingsPath: "spec/review/ga.md" });

    expect([result.emits.map((event) => [event.type, event.payload["reason"]]), result.effects]).toEqual([[["spec.blocked", "critic_cap"]], []]);
  });

  it("treats spec.rework as bookkeeping without state change or effects", () => {
    const state = stateAt("spec_drafting", 1);

    const result = applied(state, "spec.rework", { round: 1, findingsPath: "spec/review/ga.md" });

    expect([result.state.status, result.emits, result.effects]).toEqual(["spec_drafting", [], []]);
  });

  it("marks the spec approved and starts both design roles in one transition", () => {
    const result = applied(stateAt("spec_review", 2), "spec.approved", { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 12 });

    expect([result.state.status, result.effects]).toEqual(["spec_approved", [{ kind: "design.architect", attempt: 1 }, { kind: "design.verification", attempt: 1 }]]);
  });

  it("fails the run at stage spec with the blocked reason and detail", () => {
    const result = applied(stateAt("spec_drafting"), "spec.blocked", { reason: "lint_cap", detail: "lint_cap sdd:weasel" });

    expect([result.state.status, result.state.failure, result.emits]).toEqual([
      "failed",
      { stage: "spec", reason: "lint_cap", detail: "lint_cap sdd:weasel" },
      [{ type: "run.failed", producer: "foreman", payload: { stage: "spec", reason: "lint_cap", detail: "lint_cap sdd:weasel" } }],
    ]);
  });

  it("ignores spec.approved while the run is still drafting", () => {
    const outcome = reduce(specStageRules(DEFAULT_CONFIG.caps), stateAt("spec_drafting"), delivered("spec.approved", { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 1 }), new Set());

    expect(outcome.kind).toBe("out_of_order_ignored");
  });
});
