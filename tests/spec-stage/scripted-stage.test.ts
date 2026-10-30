import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFactoryRuntime, createReactor } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import { composeEffectRunner, composeRules, type Slice } from "../../src/shared/slice.js";
import { createSpecStageSlice } from "../../src/spec-stage/index.js";
import { analystHandoff, CLI_SPEC, criticHandoff, gaReview, RUN_ID, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type RoleScript, type StageWorkspace } from "./harness.js";

const FINALIZED = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo-cli:SUR-001","todo-cli:CTR-001"]}', stderr: "" };

const DECIDE_FINDING = "- id: GA-001\n  kind: gap\n  target_ids: [todo-cli:CTR-001]\n  resolution: decide\n  required_change: add error_taxonomy";

const designStub: Slice = { name: "design-stub", rules: [], effects: { "design.architect": async () => undefined, "design.verification": async () => undefined }, participants: () => [] };

function analystWrites(ws: StageWorkspace, attempt: number): RoleScript {
  return () => writeText(join(ws.handoffsDir, "spec-analyst", "handoff.md"), analystHandoff(attempt));
}

function criticAnswers(ws: StageWorkspace, round: number, decision: "accept" | "rework"): RoleScript {
  return async () => {
    await writeText(ws.gaPath, gaReview(round, decision, decision === "rework" ? DECIDE_FINDING : `${DECIDE_FINDING}\n  applied: yes`));
    await writeText(join(ws.handoffsDir, "spec-critic", "handoff.md"), criticHandoff(round, decision));
  };
}

async function scriptedStage(ws: StageWorkspace, scripts: readonly RoleScript[]): Promise<{ readonly trace: DeliveredEvent<EventType>[]; readonly engine: RunEngine }> {
  const roles = scriptedRoles(scripts);
  const context = sliceContext(ws, roles);
  const runtime = context.runtime;
  const slice = createSpecStageSlice({ commands: scriptedCommands(sddReplies({ finalize: FINALIZED })) })(context);
  const trace: DeliveredEvent<EventType>[] = [];
  const settled: Promise<unknown>[] = [];
  const engine = new RunEngine({
    initialState: runStateAt("workspace"),
    rules: composeRules([slice, designStub]),
    store: { write: async () => undefined },
    publisher: runtime.publisher,
    effects: composeEffectRunner([slice, designStub], context),
    log: () => undefined,
  });
  runtime.join(createReactor("foreman", Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => settled.push(engine.consume(event))]))));
  runtime.join(createReactor("tracer", Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: DeliveredEvent<EventType>) => trace.push(event)]))));

  runtime.publisher.publish({ type: "workspace.ready", producer: "foreman", payload: { productDir: ws.productDir, slug: "todo-cli", baselineId: "todo-cli:BL-001" } });
  for (let round = 0; round < 40 && engine.state.status !== "spec_approved" && !trace.some((event) => event.type === "run.failed"); round += 1) {
    await Promise.all(settled.splice(0));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { trace, engine };
}

describe("spec stage through the run engine", () => {
  // @covers spec-stage:SCN-001
  // @covers spec-stage:BEH-002
  it("goes from workspace.ready to spec.approved through exactly one rework round, in order, with no other spec event", async () => {
    const ws = await stageWorkspace(CLI_SPEC);

    const { trace, engine } = await scriptedStage(ws, [analystWrites(ws, 1), criticAnswers(ws, 1, "rework"), analystWrites(ws, 2), criticAnswers(ws, 2, "accept")]);

    expect([trace.map((event) => [event.type, event.payload["attempt"] ?? event.payload["round"] ?? event.payload["mode"] ?? null]), engine.state.status, engine.state.stageAttempts.criticRounds]).toEqual([
      [
        ["workspace.ready", null],
        ["spec.drafted", 1],
        ["spec.reviewed", 1],
        ["spec.rework", 1],
        ["spec.drafted", 2],
        ["spec.reviewed", 2],
        ["spec.approved", "pre-authorized-at-launch"],
      ],
      "spec_approved",
      2,
    ]);
  });

  // @covers spec-stage:CST-002
  // @covers spec-stage:DLT-001
  // @covers spec-stage:SCN-001
  it("records the final round's finding as an assumption and approves after two rework answers, without a third draft", async () => {
    const ws = await stageWorkspace(CLI_SPEC);

    const { trace, engine } = await scriptedStage(ws, [analystWrites(ws, 1), criticAnswers(ws, 1, "rework"), analystWrites(ws, 2), criticAnswers(ws, 2, "rework")]);

    const assumptions = await readFile(ws.assumptionsPath, "utf8");
    expect([trace.map((event) => [event.type, event.producer]), trace.at(-2)?.payload["decision"], engine.state.status, assumptions.includes("id: todo-cli:ASM-002"), assumptions.includes("critic finding GA-001")]).toEqual([
      [
        ["workspace.ready", "foreman"],
        ["spec.drafted", "spec-analyst"],
        ["spec.reviewed", "spec-critic"],
        ["spec.rework", "foreman"],
        ["spec.drafted", "spec-analyst"],
        ["spec.reviewed", "spec-critic"],
        ["spec.approved", "foreman"],
      ],
      "rework",
      "spec_approved",
      true,
      true,
    ]);
  });

  // @covers spec-stage:SCN-001
  it("approves in one round when the first review is clean", async () => {
    const ws = await stageWorkspace(CLI_SPEC);

    const { trace } = await scriptedStage(ws, [analystWrites(ws, 1), criticAnswers(ws, 1, "accept")]);

    expect(trace.map((event) => event.type)).toEqual(["workspace.ready", "spec.drafted", "spec.reviewed", "spec.approved"]);
  });
});
