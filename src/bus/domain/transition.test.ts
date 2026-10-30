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
  return { status, attempts: { implementer: 1, testWriter: 1 }, handoffReruns: {}, baseSha: SHA, testsSha: SHA, implSha: null, worktree: "/wt/T-001", covers: [], writes: [], dependsOn: [], lastEvent: "task.tests_red" };
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
  // @covers bus:DLT-006
  // @covers bus:BEH-002
  it("applies a task.rework of the same attempt with a different target after the first was consumed", () => {
    const toImplementer = delivered("task.rework", { taskId: "T-003", target: "implementer", attempt: 2, reason: "r", findingPath: null }, 10);
    const toTestWriter = delivered("task.rework", { taskId: "T-003", target: "test-writer", attempt: 2, reason: "r", findingPath: null }, 11);

    expect(dedupeKey(toTestWriter) === dedupeKey(toImplementer)).toBe(false);
  });

  // @covers bus:DLT-006
  it("keys task.rework on taskId, target and attempt so a redelivery of the same target is a duplicate", () => {
    expect(dedupeKey(delivered("task.rework", { taskId: "T-003", target: "implementer", attempt: 2, reason: "r", findingPath: null }, 10))).toBe(
      "task.rework|todo-cli-20261029-120000|T-003:implementer|2",
    );
  });

  // @covers bus:DLT-006
  it("keys assembly.rework on taskId, target and round", () => {
    expect(dedupeKey(delivered("assembly.rework", { round: 1, taskId: "T-002", target: "planner" }, 10))).toBe("assembly.rework|todo-cli-20261029-120000|T-002:planner|1");
  });

  // @covers bus:DLT-006
  // @covers bus:CTR-004
  it("gives design.rework from two origin tasks in one attempt window distinct keys", () => {
    const fromFirst = delivered("design.rework", { target: "planner", reason: "r", attempt: 1, originTaskId: "T-001" }, 10);
    const fromSecond = delivered("design.rework", { target: "planner", reason: "r", attempt: 1, originTaskId: "T-002" }, 11);

    expect([dedupeKey(fromFirst), dedupeKey(fromSecond)]).toEqual(["design.rework|todo-cli-20261029-120000|planner:T-001|1", "design.rework|todo-cli-20261029-120000|planner:T-002|1"]);
  });

  // @covers bus:DLT-006
  it("keys a design-stage design.rework on its target with no origin task", () => {
    expect(dedupeKey(delivered("design.rework", { target: "architect", reason: "r", attempt: 1, originTaskId: null }, 10))).toBe("design.rework|todo-cli-20261029-120000|architect:|1");
  });

  // @covers bus:DLT-006
  it("ignores a redelivered task.rework with the same target and attempt as duplicate_ignored", () => {
    const rework = delivered("task.rework", { taskId: "T-001", target: "implementer", attempt: 2, reason: "r", findingPath: null }, 10);
    const rule: TransitionRule = { name: "rework", eventType: "task.rework", apply: ({ state }) => ({ state, emits: [], effects: [] }) };

    const outcome = reduce([rule], stateWithTask("review_pending"), { ...rework, seq: 11 }, new Set([dedupeKey(rework) ?? ""]));

    expect(outcome.kind).toBe("duplicate_ignored");
  });
});
