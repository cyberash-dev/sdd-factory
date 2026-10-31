import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFactoryRuntime, createReactor } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import { readTextOrNull } from "../../src/shared/fs/text.js";
import { composeEffectRunner, composeRules, type Slice } from "../../src/shared/slice.js";
import { createSpecStageSlice } from "../../src/spec-stage/index.js";
import { analystHandoff, CLI_SPEC, criticHandoff, gaReview, MAJOR_ASSUMPTION_BODY, MAJOR_ERRORS_FINDING, MINOR_ASSUMPTION_BODY, MINOR_NEGATIVE_FINDING, MINOR_TITLE_FINDING, RUN_ID, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type RoleScript, type StageWorkspace } from "./harness.js";

const FINALIZED = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo-cli:SUR-001","todo-cli:CTR-001"]}', stderr: "" };

const DECIDE_FINDING = "- id: GA-001\n  kind: gap\n  target_ids: [todo-cli:CTR-001]\n  resolution: decide\n  required_change: add error_taxonomy";

const designStub: Slice = { name: "design-stub", rules: [], effects: { "design.architect": async () => undefined, "design.verification": async () => undefined }, participants: () => [] };

function analystWrites(ws: StageWorkspace, attempt: number): RoleScript {
  return () => writeText(join(ws.handoffsDir, "spec-analyst", "handoff.md"), analystHandoff(attempt));
}

function criticAnswers(ws: StageWorkspace, round: number, decision: "accept" | "rework"): RoleScript {
  return async () => {
    await writeText(ws.gaPath, gaReview(round, decision, decision === "rework" ? DECIDE_FINDING : round === 1 ? "[]" : `${DECIDE_FINDING}\n  applied: yes`));
    await writeText(join(ws.handoffsDir, "spec-critic", "handoff.md"), criticHandoff(round, decision));
  };
}

function criticWrites(ws: StageWorkspace, gaText: string, handoffText: string): RoleScript {
  return async () => {
    await writeText(ws.gaPath, gaText);
    await writeText(join(ws.handoffsDir, "spec-critic", "handoff.md"), handoffText);
  };
}

function analystRecordsMessage(ws: StageWorkspace, attempt: number, messages: string[]): RoleScript {
  return async (request) => {
    messages.push(request.message);
    await writeText(join(ws.handoffsDir, "spec-analyst", "handoff.md"), analystHandoff(attempt));
  };
}

function twoSurfaceSpec(): string {
  const secondSurface = CLI_SPEC.slice(CLI_SPEC.indexOf("```yaml"), CLI_SPEC.indexOf("## 7.")).replace("todo-cli:SUR-001", "todo-cli:SUR-002");
  return CLI_SPEC.replace("## 7. Data contracts", `${secondSurface}\n## 7. Data contracts`);
}

function analystRedraftsFromGate(ws: StageWorkspace, attempt: number, messages: string[]): RoleScript {
  return async (request) => {
    messages.push(request.message);
    await writeText(ws.specPath, CLI_SPEC);
    await writeText(join(ws.handoffsDir, "spec-analyst", "handoff.md"), analystHandoff(attempt));
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
  // @covers spec-stage:DLT-002
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

  // @covers spec-stage:DLT-014
  it("starts the analyst rework with ga-major.md holding only the major finding and its assumption body", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const reworkMessages: string[] = [];
    const roundOne = gaReview(1, "rework", `${MINOR_TITLE_FINDING}\n${MAJOR_ERRORS_FINDING}\n${MINOR_NEGATIVE_FINDING}`, [MAJOR_ASSUMPTION_BODY, MINOR_ASSUMPTION_BODY]);

    await scriptedStage(ws, [analystWrites(ws, 1), criticWrites(ws, roundOne, criticHandoff(1, "rework")), analystRecordsMessage(ws, 2, reworkMessages), criticAnswers(ws, 2, "accept")]);

    expect([reworkMessages.map((message) => message.includes("Critic findings to apply (none on attempt 1): spec/review/ga-major.md")), await readTextOrNull(join(ws.productDir, "spec", "review", "ga-major.md"))]).toEqual([
      [true],
      [
        "# Spec review: todo-cli, round 1",
        "",
        "decision: rework",
        "",
        "## Findings",
        "```yaml",
        "- id: GA-002",
        "  kind: gap",
        "  target_ids: [todo-cli:CTR-001]",
        "  severity: major",
        "  resolution: decide",
        "  required_change: |",
        "    add error_taxonomy with E_USAGE",
        "  assumption: todo-cli:ASM-002",
        "```",
        "",
        "## Assumptions",
        "",
        "```yaml",
        "---",
        "id: todo-cli:ASM-002",
        "type: ASSUMPTION",
        "lifecycle: {status: proposed}",
        "partition_id: todo-cli",
        "assumption: a usage error exits 2 with E_USAGE",
        "source_open_q: not_applicable",
        "blocking: no",
        "---",
        "```",
        "",
      ].join("\n"),
    ]);
  });

  // @covers spec-stage:DLT-014
  it("approves after round 1 when the critic answers rework over minor findings only", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roundOne = gaReview(1, "rework", `${MINOR_TITLE_FINDING}\n${MINOR_NEGATIVE_FINDING}`);

    const { trace, engine } = await scriptedStage(ws, [analystWrites(ws, 1), criticWrites(ws, roundOne, criticHandoff(1, "rework"))]);

    expect([trace.map((event) => [event.type, event.producer, event.payload["decision"] ?? null]), engine.state.status]).toEqual([
      [
        ["workspace.ready", "foreman", null],
        ["spec.drafted", "spec-analyst", null],
        ["spec.reviewed", "foreman", "accept"],
        ["spec.approved", "foreman", null],
      ],
      "spec_approved",
    ]);
  });

  // @covers spec-stage:DLT-011
  it("sends a failed approval gate back to the analyst with gate.md and approves the redraft after the next critic round", async () => {
    const ws = await stageWorkspace(twoSurfaceSpec());
    const redraftMessages: string[] = [];

    const { trace, engine } = await scriptedStage(ws, [analystWrites(ws, 1), criticAnswers(ws, 1, "accept"), analystRedraftsFromGate(ws, 2, redraftMessages), criticAnswers(ws, 2, "accept")]);

    expect([
      trace.map((event) => [event.type, event.payload["attempt"] ?? event.payload["round"] ?? event.payload["findingsPath"] ?? null]),
      engine.state.stageAttempts.specGateReworks,
      redraftMessages.map((message) => message.includes("Critic findings to apply (none on attempt 1): spec/review/gate.md")),
    ]).toEqual([
      [
        ["workspace.ready", null],
        ["spec.drafted", 1],
        ["spec.reviewed", 1],
        ["spec.gate_failed", "spec/review/gate.md"],
        ["spec.rework", 1],
        ["spec.drafted", 2],
        ["spec.reviewed", 2],
        ["spec.approved", null],
      ],
      1,
      [true],
    ]);
  });

  // @covers spec-stage:DLT-011
  it("fails the run with analyst_blocked when the gate fails again after the gate rework cap is spent", async () => {
    const ws = await stageWorkspace(twoSurfaceSpec());

    const { trace } = await scriptedStage(ws, [analystWrites(ws, 1), criticAnswers(ws, 1, "accept"), analystWrites(ws, 2), criticAnswers(ws, 2, "accept")]);

    expect(trace.slice(-3).map((event) => [event.type, event.payload["reason"] ?? null])).toEqual([
      ["spec.gate_failed", null],
      ["spec.blocked", "analyst_blocked"],
      ["run.failed", "analyst_blocked"],
    ]);
  });

  // @covers spec-stage:SCN-001
  it("approves in one round when the first review is clean", async () => {
    const ws = await stageWorkspace(CLI_SPEC);

    const { trace } = await scriptedStage(ws, [analystWrites(ws, 1), criticAnswers(ws, 1, "accept")]);

    expect(trace.map((event) => event.type)).toEqual(["workspace.ready", "spec.drafted", "spec.reviewed", "spec.approved"]);
  });
});
