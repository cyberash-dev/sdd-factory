import { describe, expect, it } from "vitest";
import type { EventType } from "./catalogue.js";
import type { DeliveredEvent, EventPayload } from "./envelope.js";
import { createRunState, type RunState, type TaskState } from "./run-state.js";
import { dedupeKey, reduce, type TransitionRule } from "./transition.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function delivered(type: EventType, payload: EventPayload, seq: number): DeliveredEvent<EventType> {
  return { type, runId: "todo-cli-20261029-120000", occurredAt: `2026-10-29T12:00:${String(seq).padStart(2, "0")}.000Z`, producer: "foreman", payload, seq };
}

function taskIn(status: TaskState["status"]): TaskState {
  return { status, attempts: { implementer: 1, testWriter: 1 }, baseSha: SHA, testsSha: SHA, implSha: null, worktree: "/wt/T-001", covers: [], writes: [], lastEvent: "task.tests_red" };
}

function stateWithTask(status: TaskState["status"]): RunState {
  const base = createRunState({ runId: "todo-cli-20261029-120000", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
  return { ...base, status: "building", tasks: { "T-001": taskIn(status) } };
}

const verifyRule: TransitionRule = {
  name: "impl_done -> verify_pending",
  eventType: "task.impl_done",
  acceptsTaskStatus: ["impl_pending"],
  apply({ state }) {
    const task = state.tasks["T-001"];
    if (task === undefined) {
      throw new Error("missing task");
    }
    return { state: { ...state, tasks: { "T-001": { ...task, status: "verify_pending", lastEvent: "task.impl_done" } } }, emits: [], effects: [{ kind: "verify" }] };
  },
};

const implDone = (seq: number): DeliveredEvent<EventType> =>
  delivered("task.impl_done", { taskId: "T-001", attempt: 1, handoffPath: "h.md", costUsd: null, inputTokens: 1, outputTokens: 1, durationMs: 5 }, seq);

describe("reduce", () => {
  // @covers bus:BEH-002
  it("applies a transition and stamps updatedAt and lastSeq from the event", () => {
    const outcome = reduce([verifyRule], stateWithTask("impl_pending"), implDone(42), new Set());

    expect(outcome.kind === "applied" && [outcome.result.state.tasks["T-001"]?.status, outcome.result.state.lastSeq, outcome.result.state.updatedAt]).toEqual([
      "verify_pending",
      42,
      "2026-10-29T12:00:42.000Z",
    ]);
  });

  it("ignores an exact duplicate delivery as duplicate_ignored", () => {
    const consumed = new Set([dedupeKey(implDone(42)) ?? ""]);

    const outcome = reduce([verifyRule], stateWithTask("impl_pending"), implDone(43), consumed);

    expect(outcome.kind).toBe("duplicate_ignored");
  });

  it("ignores an event the task status does not accept as out_of_order_ignored", () => {
    const outcome = reduce([verifyRule], stateWithTask("tests_pending"), implDone(42), new Set());

    expect(outcome.kind).toBe("out_of_order_ignored");
  });

  it("ignores an event for an unknown task as unknown_task_ignored", () => {
    const event = delivered("task.impl_done", { taskId: "T-999", attempt: 1, handoffPath: "h.md", costUsd: null, inputTokens: 1, outputTokens: 1, durationMs: 5 }, 42);

    const outcome = reduce([verifyRule], stateWithTask("impl_pending"), event, new Set());

    expect(outcome.kind).toBe("unknown_task_ignored");
  });

  it("ignores an event the run status does not accept as out_of_order_ignored", () => {
    const rule: TransitionRule = { name: "approved -> designing", eventType: "spec.approved", acceptsRunStatus: ["spec_review"], apply: ({ state }) => ({ state, emits: [], effects: [] }) };
    const state = { ...stateWithTask("ready"), status: "building" as const };

    const outcome = reduce([rule], state, delivered("spec.approved", { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 1 }, 7), new Set());

    expect(outcome.kind).toBe("out_of_order_ignored");
  });

  it("reports no_rule when no rule handles the event type", () => {
    const outcome = reduce([verifyRule], stateWithTask("impl_pending"), delivered("design.blocked", { reason: "x" }, 1), new Set());

    expect(outcome.kind).toBe("no_rule");
  });

  it("builds the dedupe key from type, runId, taskId and attempt", () => {
    expect(dedupeKey(implDone(1))).toBe("task.impl_done|todo-cli-20261029-120000|T-001|1");
  });

  it("gives events without a counter no dedupe key", () => {
    expect(dedupeKey(delivered("design.tech.ready", { path: "design/tech.md" }, 1))).toBeNull();
  });
});
