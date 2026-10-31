import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Tool } from "@mozaik-ai/core";
import type { EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import { reduce, type TransitionResult } from "../../src/bus/domain/transition.js";
import { DEFAULT_CONFIG, type Caps, type FactoryConfig } from "../../src/shared/config.js";
import { runDraft } from "../../src/spec-stage/application/draft.js";
import { runReview } from "../../src/spec-stage/application/review.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import { specStageRules } from "../../src/spec-stage/domain/rules.js";
import { analystHandoff, CLI_SPEC, effectContext, gaReview, RUN_ID, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type RoleScript, type StageWorkspace } from "./harness.js";

const DECIDE_FINDING = "- id: GA-001\n  kind: gap\n  target_ids: [todo-cli:CTR-001]\n  resolution: decide\n  required_change: add error_taxonomy";

const analystHandoffPath = (ws: StageWorkspace): string => join(ws.handoffsDir, "spec-analyst", "handoff.md");

const criticHandoffPath = (ws: StageWorkspace): string => join(ws.handoffsDir, "spec-critic", "handoff.md");

const writesNoHandoff: RoleScript = async () => undefined;

const deps = () => ({ commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

function configWithCaps(caps: Partial<Caps>): FactoryConfig {
  return { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, ...caps } };
}

function toolNamed(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
}

function reworkAnsweredInRound(caps: Caps, round: number): TransitionResult {
  const state = runStateAt("spec_review", { stageAttempts: { lintCycles: 0, criticRounds: round, plannerRecuts: 0, architectRepairs: 0, assemblyRounds: 0 } });
  const event: DeliveredEvent<EventType> = { type: "spec.reviewed", runId: RUN_ID, occurredAt: "2026-10-29T12:00:05.000Z", producer: "spec-critic", payload: { round, decision: "rework", findingsPath: "spec/review/ga.md" }, seq: 5 };
  const outcome = reduce(specStageRules(caps), state, event, new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function gateFailedAfterReworks(caps: Caps, specGateReworks: number): TransitionResult {
  const state = runStateAt("spec_review", { stageAttempts: { lintCycles: 0, criticRounds: 2, plannerRecuts: 0, architectRepairs: 0, assemblyRounds: 0, specGateReworks } });
  const event: DeliveredEvent<EventType> = { type: "spec.gate_failed", runId: RUN_ID, occurredAt: "2026-10-29T12:00:05.000Z", producer: "foreman", payload: { findingsPath: "spec/review/gate.md", detail: "approve_failed: no-id-match" }, seq: 5 };
  const outcome = reduce(specStageRules(caps), state, event, new Set());
  if (outcome.kind !== "applied") {
    throw new Error(`expected applied, got ${outcome.kind}`);
  }
  return outcome.result;
}

function criticWritesGarbage(ws: StageWorkspace): RoleScript {
  return () => writeText(criticHandoffPath(ws), "no frontmatter here\n");
}

function analystLinting(ws: StageWorkspace, lintCalls: number, replies: unknown[]): RoleScript {
  return async (request) => {
    const sdd = toolNamed(request.tools, "run_sdd");
    for (let call = 0; call < lintCalls; call += 1) {
      replies.push(await sdd.invoke({ argv: "lint --format=json" }));
    }
    await writeText(analystHandoffPath(ws), analystHandoff(1, { status: "blocked", lint_exit: 1, blocked_reason: "lint_cap sdd:weasel-word" }));
  };
}

describe("caps.specGateReworks read from the configuration", () => {
  // @covers factory:DLT-015
  it("routes a second gate failure to the analyst when caps.specGateReworks is 2", () => {
    const caps = configWithCaps({ specGateReworks: 2 }).caps;

    const result = gateFailedAfterReworks(caps, 1);

    expect([result.state.status, result.state.stageAttempts.specGateReworks, result.effects]).toEqual(["spec_drafting", 2, [{ kind: "spec.draft", attempt: 3, reworkFinding: "spec/review/gate.md" }]]);
  });

  // @covers factory:DLT-015
  it("blocks the third gate failure when caps.specGateReworks is 2", () => {
    const caps = configWithCaps({ specGateReworks: 2 }).caps;

    const result = gateFailedAfterReworks(caps, 2);

    expect(result.emits).toEqual([{ type: "spec.blocked", producer: "foreman", payload: { reason: "analyst_blocked", detail: "approve_failed: no-id-match" } }]);
  });
});

describe("caps.criticRounds read from the configuration", () => {
  // @covers factory:DLT-015
  it("routes a round-2 rework to the analyst as attempt 3 when caps.criticRounds is 3", () => {
    const caps = configWithCaps({ criticRounds: 3 }).caps;

    const result = reworkAnsweredInRound(caps, 2);

    expect([result.state.status, result.effects]).toEqual(["spec_drafting", [{ kind: "spec.draft", attempt: 3, reworkFinding: "spec/review/ga.md" }]]);
  });

  // @covers factory:DLT-015
  it("hands the round-3 rework findings to the foreman instead of a fourth draft when caps.criticRounds is 3", () => {
    const caps = configWithCaps({ criticRounds: 3 }).caps;

    const result = reworkAnsweredInRound(caps, 3);

    expect([result.state.status, result.effects]).toEqual(["spec_review", [{ kind: "spec.assume_findings", round: 3, findingsPath: "spec/review/ga.md" }]]);
  });

  // @covers factory:DLT-015
  it("counts an unparseable round 2 over an unapplied finding as a non-final accept when caps.criticRounds is 3", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(ws.gaPath, gaReview(1, "rework", DECIDE_FINDING));
    const roles = scriptedRoles([criticWritesGarbage(ws), criticWritesGarbage(ws)]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 2 }, context, sliceContext(ws, roles, configWithCaps({ criticRounds: 3 })), deps());

    expect(published).toEqual([{ type: "spec.reviewed", producer: "foreman", payload: { round: 2, decision: "accept", findingsPath: "spec/review/ga.md" } }]);
  });

  // @covers factory:DLT-015
  it("hands an unparseable round 3 over an unapplied finding to the foreman as the final rework when caps.criticRounds is 3", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(ws.gaPath, gaReview(2, "rework", DECIDE_FINDING));
    const roles = scriptedRoles([criticWritesGarbage(ws), criticWritesGarbage(ws)]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 3 }, context, sliceContext(ws, roles, configWithCaps({ criticRounds: 3 })), deps());

    expect(published).toEqual([{ type: "spec.reviewed", producer: "foreman", payload: { round: 3, decision: "rework", findingsPath: "spec/review/ga.md" } }]);
  });
});

describe("caps.lintCycles read from the configuration", () => {
  // @covers factory:DLT-015
  it("runs a sixth lint cycle through run_sdd when caps.lintCycles is 6", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: '{"ok":false}', stderr: "" } }));
    const replies: unknown[] = [];
    const roles = scriptedRoles([analystLinting(ws, 6, replies)]);
    const { context } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles, configWithCaps({ lintCycles: 6 })), { commands, clock: createStageClock() });

    expect([commands.calls.length, replies[5]]).toEqual([7, 'exit 1\n{"ok":false}']);
  });

  // @covers factory:DLT-015
  it("refuses the seventh lint cycle through run_sdd with the lint cap of 6 when caps.lintCycles is 6", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: '{"ok":false}', stderr: "" } }));
    const replies: unknown[] = [];
    const roles = scriptedRoles([analystLinting(ws, 7, replies)]);
    const { context } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles, configWithCaps({ lintCycles: 6 })), { commands, clock: createStageClock() });

    expect([commands.calls.length, replies[6]]).toEqual([7, 'ERROR: lint cap of 6 runs reached; write the handoff with status blocked and blocked_reason "lint_cap <rule ids>"']);
  });
});

describe("caps.handoffRerun read from the configuration", () => {
  // @covers factory:DLT-015
  it("re-runs the analyst a second time and drafts from its third handoff when caps.handoffRerun is 2", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([writesNoHandoff, writesNoHandoff, () => writeText(analystHandoffPath(ws), analystHandoff(1))]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles, configWithCaps({ handoffRerun: 2 })), deps());

    expect([roles.requests.length, published.map((event) => event.type)]).toEqual([3, ["spec.drafted"]]);
  });

  // @covers factory:DLT-015
  it("blocks the stage on an unparseable analyst handoff after the third missing handoff when caps.handoffRerun is 2", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([writesNoHandoff, writesNoHandoff, writesNoHandoff]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles, configWithCaps({ handoffRerun: 2 })), deps());

    expect([roles.requests.length, published]).toEqual([3, [{ type: "spec.blocked", producer: "spec-analyst", payload: { reason: "analyst_blocked", detail: "unparseable_handoff: missing_file" } }]]);
  });
});
