import { describe, expect, it } from "vitest";
import { createReactor } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import { createDesignStageSlice } from "../../src/design-stage/index.js";
import { composeEffectRunner, composeRules, type Slice } from "../../src/shared/slice.js";
import { createSpecStageSlice } from "../../src/spec-stage/index.js";
import { ARCHITECT_HANDOFF_LINES, handoffPathIn, handoffText, harness, PLANNER_HANDOFF_LINES, stateIn, tasksJsonText, techMdText, VALID_TASKS, VERIFICATION_HANDOFF_LINES, verificationMdText, writeVia, type RoleScript } from "../design-stage/harness.js";

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function roleScript(journal: string[], role: string, write: Parameters<RoleScript>[0] extends infer R ? (request: R) => Promise<void> : never): RoleScript {
  return async (request) => {
    journal.push(`started:${role}`);
    await yieldTurn();
    await yieldTurn();
    await write(request);
    journal.push(`finished:${role}`);
  };
}

describe("two LLM participants are active at the same time in the design stage", () => {
  // @covers bus:INV-003
  // @covers bus:CST-002
  it("starts the architect and the verification-designer before either of them finishes", async () => {
    const journal: string[] = [];
    const h = await harness({
      scripts: {
        architect: [
          roleScript(journal, "architect", async (request) => {
            await writeVia(request, "design/tech.md", techMdText());
            await writeVia(request, handoffPathIn(request), handoffText("architect", 1, ARCHITECT_HANDOFF_LINES));
          }),
        ],
        "verification-designer": [
          roleScript(journal, "verification-designer", async (request) => {
            await writeVia(request, "design/verification.md", verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]));
            await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
          }),
        ],
        planner: [
          roleScript(journal, "planner", async (request) => {
            await writeVia(request, "design/tasks.json", tasksJsonText(VALID_TASKS));
            await writeVia(request, handoffPathIn(request), handoffText("planner", 1, PLANNER_HANDOFF_LINES));
          }),
        ],
      },
    });
    const specSlice = createSpecStageSlice()(h.slice);
    const designSlice = createDesignStageSlice({ commands: h.commandRunner })(h.slice);
    const buildStub: Slice = { name: "build-stub", rules: [], effects: { "build.schedule": async () => undefined }, participants: () => [] };
    const settled: Promise<unknown>[] = [];
    const engine = new RunEngine({
      initialState: stateIn("spec_review"),
      rules: composeRules([specSlice, designSlice]),
      store: { write: async () => undefined },
      publisher: h.slice.runtime.publisher,
      effects: composeEffectRunner([specSlice, designSlice, buildStub], h.slice),
      log: () => undefined,
    });
    h.slice.runtime.join(createReactor("foreman", Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => settled.push(engine.consume(event))]))));
    h.slice.runtime.join(createReactor("tracer", Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => journal.push(event.type)]))));

    h.slice.runtime.publisher.publish({ type: "spec.approved", producer: "foreman", payload: { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 3 } });
    for (let round = 0; round < 400 && !journal.includes("design.tasks.ready") && !journal.includes("run.failed"); round += 1) {
      await Promise.all(settled.splice(0));
      await yieldTurn();
    }

    const firstFinish = journal.findIndex((entry) => entry.startsWith("finished:"));
    expect([journal.indexOf("started:architect") < firstFinish, journal.indexOf("started:verification-designer") < firstFinish, journal.includes("design.tasks.ready")]).toEqual([true, true, true]);
  });

  it("composes the spec.approved transition into exactly the two concurrent design effects", async () => {
    const h = await harness({ scripts: {} });
    const specSlice = createSpecStageSlice()(h.slice);
    const rule = specSlice.rules.find((candidate) => candidate.eventType === "spec.approved");

    const result = rule?.apply({ state: stateIn("spec_review"), event: { type: "spec.approved", runId: h.slice.runId, occurredAt: "2026-10-29T12:00:00.000Z", producer: "foreman", payload: { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 3 }, seq: 1 } });

    expect(result?.effects.map((effect) => effect.kind).sort()).toEqual(["design.architect", "design.verification"]);
  });
});
