import { describe, expect, it } from "vitest";
import type { EventType } from "../domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../domain/envelope.js";
import { createRunState, type RunState, type TaskState } from "../domain/run-state.js";
import { dedupeKey, reduce, type PendingEvent, type TransitionRule } from "../domain/transition.js";
import { RunEngine } from "./run-engine.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = "todo-cli-20261029-120000";

interface Harness {
  readonly engine: RunEngine;
  readonly published: PendingEvent[];
  readonly journal: string[];
  readonly snapshots: RunState[];
  deliver(type: EventType, payload: EventPayload): Promise<string>;
}

function buildingState(taskStatus: TaskState["status"]): RunState {
  const base = createRunState({ runId: RUN_ID, slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
  const task: TaskState = { status: taskStatus, attempts: { implementer: 1, testWriter: 1 }, handoffReruns: {}, baseSha: SHA, testsSha: SHA, implSha: null, worktree: "/wt/T-001", covers: [], writes: [], dependsOn: [], lastEvent: "task.tests_red" };
  return { ...base, status: "building", tasks: { "T-001": task } };
}

const verifiedRule: TransitionRule = {
  name: "verified -> review_pending",
  eventType: "task.verified",
  acceptsTaskStatus: ["verify_pending"],
  apply({ state, event }) {
    const task = state.tasks["T-001"];
    if (task === undefined) {
      throw new Error("missing task");
    }
    const next = { ...state, tasks: { "T-001": { ...task, status: "review_pending" as const, lastEvent: event.type } } };
    return { state: next, emits: [{ type: "task.reviewed", producer: "reviewer", payload: { taskId: "T-001", decision: "approve", target: "none", reportPath: "reviews/T-001.md" } }], effects: [{ kind: "review" }] };
  },
};

const explodingRule: TransitionRule = {
  name: "exploding",
  eventType: "design.blocked",
  apply() {
    throw new Error("handler exploded");
  },
};

function harness(options: { readonly failWriteOn?: number; readonly failEffect?: boolean; readonly initial?: RunState } = {}): Harness {
  const published: PendingEvent[] = [];
  const journal: string[] = [];
  const snapshots: RunState[] = [];
  let writes = 0;
  let seq = 100;
  const engine = new RunEngine({
    initialState: options.initial ?? buildingState("verify_pending"),
    rules: [verifiedRule, explodingRule],
    store: {
      async write(state) {
        writes += 1;
        if (options.failWriteOn === writes) {
          throw new Error("disk full");
        }
        journal.push("persist");
        snapshots.push(state);
      },
    },
    publisher: {
      publish(pending) {
        journal.push(`publish ${pending.type}`);
        published.push(pending);
        seq += 1;
        return { ...pending, runId: RUN_ID, occurredAt: "2026-10-29T12:01:00.000Z", seq };
      },
    },
    effects: {
      async run(effect) {
        journal.push(`effect ${effect.kind}`);
        if (options.failEffect === true) {
          throw new Error("verifier crashed");
        }
      },
    },
    log: () => undefined,
  });
  let delivered = 41;
  return {
    engine,
    published,
    journal,
    snapshots,
    deliver: (type, payload) => {
      delivered += 1;
      return engine.consume({ type, runId: RUN_ID, occurredAt: "2026-10-29T12:00:30.000Z", producer: "foreman", payload, seq: delivered });
    },
  };
}

const verifiedGreen = { taskId: "T-001", result: "green", evidencePath: "verifier-green-1.json", testsUnchanged: true, writeSetOk: true };

describe("RunEngine", () => {
  // @covers bus:BEH-004
  it("persists the snapshot before publishing the resulting events", async () => {
    const h = harness();

    await h.deliver("task.verified", verifiedGreen);

    expect(h.journal).toEqual(["persist", "publish task.reviewed", "effect review"]);
  });

  it("turns a failed snapshot write into run.failed with reason runtime_error and publishes nothing else", async () => {
    const h = harness({ failWriteOn: 1 });

    await h.deliver("task.verified", verifiedGreen);

    expect(h.published.map((event) => [event.type, event.payload["reason"], event.payload["stage"]])).toEqual([["run.failed", "runtime_error", "build"]]);
  });

  // @covers bus:BEH-002
  // @covers bus:SCN-001
  it("applies one transition and one effect for two deliveries of the same event", async () => {
    const h = harness();

    await h.deliver("task.verified", verifiedGreen);
    await h.deliver("task.verified", verifiedGreen);

    expect(h.journal).toEqual(["persist", "publish task.reviewed", "effect review"]);
  });

  it("leaves the state untouched for an out-of-order event", async () => {
    const h = harness({ initial: buildingState("tests_pending") });
    const before = h.engine.state;

    const outcome = await h.deliver("task.verified", verifiedGreen);

    expect([outcome, h.engine.state === before, h.journal]).toEqual(["out_of_order_ignored", true, []]);
  });

  // @covers bus:BEH-006
  it("turns a throwing effect into run.failed with reason runtime_error", async () => {
    const h = harness({ failEffect: true });

    await h.deliver("task.verified", verifiedGreen);
    await new Promise((resolve) => setImmediate(resolve));

    expect(h.published.map((event) => event.type)).toEqual(["task.reviewed", "run.failed"]);
  });

  it("rejects the consume promise when a rule throws so the caller can fail the run", async () => {
    const h = harness();

    await expect(h.deliver("design.blocked", { reason: "x" })).rejects.toThrow("handler exploded");
  });

  // @covers bus:INV-004
  it("ignores every event after the run reached a terminal status", async () => {
    const terminal = { ...buildingState("verify_pending"), status: "failed" as const };
    const h = harness({ initial: terminal });

    const outcome = await h.deliver("task.verified", verifiedGreen);

    expect([outcome, h.published]).toEqual(["terminal_ignored", []]);
  });

  // @covers bus:INV-001
  it("reproduces every persisted snapshot by replaying the consumed events through reduce", async () => {
    const initial = buildingState("verify_pending");
    const h = harness({ initial });
    const events: DeliveredEvent<EventType>[] = [
      { type: "task.verified", runId: RUN_ID, occurredAt: "2026-10-29T12:00:30.000Z", producer: "foreman", payload: verifiedGreen, seq: 42 },
      { type: "task.verified", runId: RUN_ID, occurredAt: "2026-10-29T12:00:31.000Z", producer: "foreman", payload: verifiedGreen, seq: 43 },
    ];
    for (const event of events) {
      await h.engine.consume(event);
    }

    const replayed: RunState[] = [];
    const consumed = new Set<string>();
    let state = initial;
    for (const event of events) {
      const outcome = reduce([verifiedRule], state, event, consumed);
      if (outcome.kind === "applied") {
        state = outcome.result.state;
        replayed.push(state);
        const key = dedupeKey(event);
        if (key !== null) {
          consumed.add(key);
        }
      }
    }

    expect([replayed, h.snapshots.map((snapshot) => snapshot.lastSeq)]).toEqual([h.snapshots, [42]]);
  });

  it("logs a warning instead of a second terminal event when failing after the terminal status", () => {
    const terminal = { ...buildingState("verify_pending"), status: "published" as const };
    const h = harness({ initial: terminal });

    h.engine.fail(null, "runtime_error", "late error");

    expect(h.published).toEqual([]);
  });
});
