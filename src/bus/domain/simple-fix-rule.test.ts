import { describe, expect, it } from "vitest";
import type { EventType } from "./catalogue.js";
import type { DeliveredEvent, EventPayload } from "./envelope.js";
import { createRunState, type RunState } from "./run-state.js";
import { SIMPLE_FIX_RULE } from "./simple-fix-rule.js";
import { dedupeKey, reduce } from "./transition.js";

function fixAttempted(payload: EventPayload, seq: number): DeliveredEvent<EventType> {
  return { type: "fix.attempted", runId: "todo-cli-20261029-120000", occurredAt: "2026-10-29T12:00:00.000Z", producer: "simple-fixer", payload, seq };
}

function specFix(owner: string, unit: string, attempt: number): EventPayload {
  return {
    stage: unit === "spec" ? "spec" : "design",
    taskId: null,
    unit,
    owner,
    trigger: unit === "spec" ? "spec_yaml_invalid" : "design_file_invalid",
    attempt,
    outcome: "unfixed",
    filesChanged: [],
    answerPath: `handoffs/${unit}/simple-fixer/answer-run${attempt}.md`,
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 1,
  };
}

function aRunState(): RunState {
  return { ...createRunState({ runId: "todo-cli-20261029-120000", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" }), status: "designing" };
}

describe("fix.attempted reduction", () => {
  // @covers bus:DLT-005
  it("increments the simple-fix counter of the event's owner and unit by one per attempt", () => {
    const first = reduce([SIMPLE_FIX_RULE], aRunState(), fixAttempted(specFix("architect", "design", 1), 1), new Set());
    const afterFirst = first.kind === "applied" ? first.result.state : aRunState();

    const second = reduce([SIMPLE_FIX_RULE], afterFirst, fixAttempted(specFix("architect", "design", 2), 2), new Set());

    expect([afterFirst.simpleFixes, second.kind === "applied" ? second.result.state.simpleFixes : null]).toEqual([{ "architect:design": 1 }, { "architect:design": 2 }]);
  });

  it("emits nothing and requests no effect", () => {
    const outcome = reduce([SIMPLE_FIX_RULE], aRunState(), fixAttempted(specFix("spec-analyst", "spec", 1), 1), new Set());

    expect(outcome.kind === "applied" ? [outcome.result.emits, outcome.result.effects] : outcome.kind).toEqual([[], []]);
  });

  // @covers bus:CTR-009
  it("keys the dedupe of fix.attempted by owner, unit and attempt so two owners' first attempts are both applied", () => {
    expect([dedupeKey(fixAttempted(specFix("spec-analyst", "spec", 1), 1)), dedupeKey(fixAttempted(specFix("architect", "design", 1), 2))]).toEqual([
      "fix.attempted|todo-cli-20261029-120000|spec-analyst:spec|1",
      "fix.attempted|todo-cli-20261029-120000|architect:design|1",
    ]);
  });
});
