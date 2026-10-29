import { describe, expect, it } from "vitest";
import { createFactoryRuntime, createReactor } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import { createRunState } from "../../src/bus/domain/run-state.js";
import type { TransitionRule } from "../../src/bus/domain/transition.js";

const RUN_ID = "todo-cli-20261029-120000";

const rules: readonly TransitionRule[] = [
  {
    name: "run.started -> workspace",
    eventType: "run.started",
    acceptsRunStatus: ["started"],
    apply: ({ state }) => ({
      state: { ...state, status: "workspace" },
      emits: [{ type: "human.intervention", producer: "foreman", payload: { kind: "launch", note: "pre-authorized", actor: state.operator } }],
      effects: [{ kind: "bootstrap" }],
    }),
  },
  {
    name: "workspace.ready -> spec_drafting",
    eventType: "workspace.ready",
    acceptsRunStatus: ["workspace"],
    apply: ({ state }) => ({ state: { ...state, status: "spec_drafting" }, emits: [], effects: [{ kind: "draft" }] }),
  },
  {
    name: "spec.blocked -> failed",
    eventType: "spec.blocked",
    acceptsRunStatus: ["spec_drafting"],
    apply: ({ state, event }) => ({
      state: { ...state, status: "failed", failure: { stage: "spec", reason: "lint_cap", detail: String(event.payload["detail"]) } },
      emits: [{ type: "run.failed", producer: "foreman", payload: { stage: "spec", reason: "lint_cap", detail: String(event.payload["detail"]) } }],
      effects: [],
    }),
  },
];

interface ScriptedRun {
  readonly trace: DeliveredEvent<EventType>[];
  readonly engine: RunEngine;
}

async function scriptedFailingRun(): Promise<ScriptedRun> {
  const runtime = createFactoryRuntime(RUN_ID);
  const trace: DeliveredEvent<EventType>[] = [];
  const settled: Promise<unknown>[] = [];
  const engine = new RunEngine({
    initialState: createRunState({ runId: RUN_ID, slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" }),
    rules,
    store: { write: async () => undefined },
    publisher: runtime.publisher,
    effects: {
      async run(effect, context) {
        if (effect.kind === "bootstrap") {
          context.publish({ type: "workspace.ready", producer: "foreman", payload: { productDir: "/tmp/product", slug: "todo-cli", baselineId: "todo-cli:BL-001" } });
        }
        if (effect.kind === "draft") {
          context.publish({ type: "spec.blocked", producer: "spec-analyst", payload: { reason: "lint_cap", detail: "5 cycles" } });
        }
      },
    },
    log: () => undefined,
  });
  const everyType = Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => settled.push(engine.consume(event))]));
  runtime.join(createReactor("foreman", everyType));
  runtime.join(createReactor("tracer", Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => trace.push(event)]))));

  runtime.publisher.publish({ type: "run.started", producer: "foreman", payload: { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" } });
  for (let round = 0; round < 10; round += 1) {
    await Promise.all(settled.splice(0));
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { trace, engine };
}

describe("scripted run over the Mozaik bus", () => {
  // @covers bus:EXT-001
  // @covers bus:INV-004
  it("delivers the run events in order through two reactors and ends with exactly one terminal event", async () => {
    const { trace, engine } = await scriptedFailingRun();

    const terminal = trace.filter((event) => event.type === "run.failed" || event.type === "run.published");
    expect([trace.map((event) => event.type), terminal.length, trace.at(-1)?.type, engine.state.status]).toEqual([
      ["run.started", "human.intervention", "workspace.ready", "spec.blocked", "run.failed"],
      1,
      "run.failed",
      "failed",
    ]);
  });

  it("numbers delivered events contiguously from 1 in publication order", async () => {
    const { trace } = await scriptedFailingRun();

    expect(trace.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});
