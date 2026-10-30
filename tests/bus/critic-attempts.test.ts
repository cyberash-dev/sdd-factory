import { describe, expect, it } from "vitest";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { EventPayload } from "../../src/bus/domain/envelope.js";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { dedupeKey, reduce, type PendingEvent } from "../../src/bus/domain/transition.js";
import { buildStageRules } from "../../src/build-stage/domain/rules/index.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { aTask, buildingState, delivered, IMPL_SHA } from "../build-stage/support/state.js";

const rules = buildStageRules({ caps: DEFAULT_CONFIG.caps, handoffsDir: "/run/handoffs", laneModel: null });

function contractReview(specId: string): readonly [EventType, EventPayload] {
  return ["task.reviewed", { taskId: "T-001", decision: "request_changes", target: "contract", reportPath: "reviews/T-001.md", specIds: [specId] }];
}

function criticReworksOf(sequence: readonly (readonly [EventType, EventPayload])[]): readonly PendingEvent[] {
  const consumed = new Set<string>();
  let state: RunState = buildingState({ "T-001": aTask({ status: "review_pending", implSha: IMPL_SHA }) });
  const reworks: PendingEvent[] = [];
  const queue: (readonly [EventType, EventPayload])[] = [...sequence];
  for (const [index, [type, payload]] of queue.entries()) {
    const event = delivered(type, payload, index + 1);
    const outcome = reduce(rules, state, event, consumed);
    if (outcome.kind === "applied") {
      state = outcome.result.state;
      const key = dedupeKey(event);
      if (key !== null) {
        consumed.add(key);
      }
      const critic = outcome.result.emits.filter((emitted) => emitted.type === "task.rework" && emitted.payload["target"] === "critic");
      reworks.push(...critic);
      queue.splice(index + 1, 0, ...critic.map((emitted) => [emitted.type, emitted.payload] as const));
    }
  }
  return reworks;
}

describe("critic rework attempts of one task", () => {
  // @covers bus:DLT-006
  // @covers bus:CTR-005
  // @covers bus:CTR-008
  it("numbers two contract findings on different spec ids of one task as critic attempts 1 and 2", () => {
    const reworks = criticReworksOf([contractReview("greeter:BEH-001"), contractReview("greeter:BEH-002")]);

    expect(reworks.map((rework) => rework.payload["attempt"])).toEqual([1, 2]);
  });
});
