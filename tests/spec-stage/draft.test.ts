import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Tool } from "@mozaik-ai/core";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { ApiRoleTimeoutError } from "../../src/shared/llm/api-role-runner.js";
import { runDraft } from "../../src/spec-stage/application/draft.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import { analystHandoff, CLI_SPEC, effectContext, exitZero, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type StageWorkspace } from "./harness.js";

const handoffPath = (ws: StageWorkspace): string => join(ws.handoffsDir, "spec-analyst", "handoff.md");

function toolNamed(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
}

describe("spec.draft effect", () => {
  // @covers spec-stage:BEH-001
  it("publishes spec.drafted with attempt 1, lintExit 0 and the record counts after a complete lint-clean handoff", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([(request) => writeText(handoffPath(ws), analystHandoff(1))]);
    const commands = scriptedCommands(sddReplies({}));
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands, clock: createStageClock() });

    expect([published, commands.calls]).toEqual([
      [{ type: "spec.drafted", producer: "spec-analyst", payload: { attempt: 1, lintExit: 0, recordCounts: { behaviors: 2, contracts: 1, invariants: 0, scenarios: 0, constraints: 1, policies: 2, open_questions: 1, assumptions: 1 } } }],
      [["lint", "--format=json"]],
    ]);
  });

  // @covers spec-stage:BEH-001
  it("renders the analyst instruction and first message from the real prompt without unresolved placeholders", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([(request) => writeText(handoffPath(ws), analystHandoff(1))]);
    const { context } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    const request = roles.requests[0];
    expect([request?.role, request?.model, request?.instruction.includes("{{"), request?.message.includes(`Handoff to write as your last action: ${handoffPath(ws)}`), request?.message.includes("Critic findings to apply (none on attempt 1): none")]).toEqual([
      "spec-analyst",
      DEFAULT_CONFIG.models.default,
      false,
      true,
      true,
    ]);
  });

  // @covers spec-stage:BEH-003
  it("hands the critic findings path to the analyst on attempt 2", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([(request) => writeText(handoffPath(ws), analystHandoff(2))]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 2, reworkFinding: "spec/review/ga.md" }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([roles.requests[0]?.message.includes("Critic findings to apply (none on attempt 1): spec/review/ga.md"), published[0]?.payload["attempt"]]).toEqual([true, 2]);
  });

  // @covers spec-stage:BEH-001
  // @covers spec-stage:CST-001
  it("maps a blocked handoff with blocked_reason lint_cap to spec.blocked{lint_cap}", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => writeText(handoffPath(ws), analystHandoff(1, { status: "blocked", lint_exit: 1, blocked_reason: "lint_cap sdd:weasel-word" }))]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect(published).toEqual([{ type: "spec.blocked", producer: "spec-analyst", payload: { reason: "lint_cap", detail: "lint_cap sdd:weasel-word" } }]);
  });

  // @covers spec-stage:BEH-001
  it("maps an unsupported product kind to spec.blocked{analyst_blocked}", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => writeText(handoffPath(ws), analystHandoff(1, { status: "blocked", lint_exit: 0, blocked_reason: "unsupported_product_kind" }))]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect(published).toEqual([{ type: "spec.blocked", producer: "spec-analyst", payload: { reason: "analyst_blocked", detail: "unsupported_product_kind" } }]);
  });

  // @covers spec-stage:CST-001
  it("refuses the sixth lint run through the run_sdd tool and counts only the five that ran", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const lintFailing = sddReplies({ lint: { exitCode: 1, stdout: '{"ok":false}', stderr: "" } });
    const commands = scriptedCommands(lintFailing);
    const replies: unknown[] = [];
    const roles = scriptedRoles([
      async (request) => {
        const sdd = toolNamed(request.tools, "run_sdd");
        for (let call = 0; call < 6; call += 1) {
          replies.push(await sdd.invoke({ argv: "lint --format=json" }));
        }
        await writeText(handoffPath(ws), analystHandoff(1, { status: "blocked", lint_exit: 1, blocked_reason: "lint_cap sdd:weasel-word" }));
      },
    ]);
    const { context } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands, clock: createStageClock() });

    expect([commands.calls.length, replies[4], replies[5]]).toEqual([
      5,
      'exit 1\n{"ok":false}',
      'ERROR: lint cap of 5 runs reached; write the handoff with status blocked and blocked_reason "lint_cap <rule ids>"',
    ]);
  });

  // @covers spec-stage:BEH-001
  it("never publishes spec.drafted when the foreman's own lint fails after a complete handoff", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => writeText(handoffPath(ws), analystHandoff(1))]);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: '{"diagnostics":[{"rule":"sdd:weasel-word"}]}', stderr: "" } }));
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands, clock: createStageClock() });

    expect(published).toEqual([{ type: "spec.blocked", producer: "spec-analyst", payload: { reason: "analyst_blocked", detail: 'lint_failed: {"diagnostics":[{"rule":"sdd:weasel-word"}]}' } }]);
  });

  // @covers spec-stage:DLT-005
  // @covers spec-stage:BEH-001
  it("appends yaml_invalid diagnostics with exit 1 to a lint sdd itself passed when a record fence does not parse", async () => {
    const ws = await stageWorkspace(CLI_SPEC.replace("title: todo add <text>", "title: `todo add` stores: items"));
    let lintResult = "";
    const roles = scriptedRoles([
      async (request) => {
        lintResult = String(await toolNamed(request.tools, "run_sdd").invoke({ argv: "lint --format=json" }));
        await writeText(handoffPath(ws), analystHandoff(1));
      },
    ]);
    const { context } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([lintResult.startsWith("exit 1\n"), lintResult.includes("yaml_invalid todo-cli:CTR-001 (spec/spec.md")]).toEqual([true, true]);
  });

  // @covers spec-stage:DLT-005
  it("blocks the draft with the yaml_invalid diagnostics when the analyst claims lint_exit 0 over an unparseable fence", async () => {
    const ws = await stageWorkspace(CLI_SPEC.replace("title: todo add <text>", "title: `todo add` stores: items"));
    const roles = scriptedRoles([() => writeText(handoffPath(ws), analystHandoff(1))]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([published[0]?.type, published[0]?.payload["reason"], String(published[0]?.payload["detail"]).includes("yaml_invalid todo-cli:CTR-001")]).toEqual(["spec.blocked", "analyst_blocked", true]);
  });

  // @covers factory:BEH-011
  it("re-runs the analyst with the timeout note when its loop exceeds the budget, then publishes spec.drafted", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      () => {
        throw new ApiRoleTimeoutError("spec-analyst exceeded 1200000 ms");
      },
      () => writeText(handoffPath(ws), analystHandoff(1)),
    ]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([roles.requests.length, roles.requests[1]?.message.includes("without a handoff; continue from the files on disk and write the handoff first"), published.map((event) => event.type)]).toEqual([2, true, ["spec.drafted"]]);
  });

  it("blocks a handoff that claims complete with a non-zero lint_exit without re-running", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => writeText(handoffPath(ws), analystHandoff(1, { lint_exit: 1 }))]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([roles.requests.length, published]).toEqual([1, [{ type: "spec.blocked", producer: "spec-analyst", payload: { reason: "analyst_blocked", detail: "handoff status complete with lint_exit 1" } }]]);
  });

  // @covers spec-stage:BEH-001
  it("re-runs the analyst once with the parse error in its message, keeps the rejected file, then blocks", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => writeText(handoffPath(ws), "no frontmatter at all\n"), () => writeText(handoffPath(ws), analystHandoff(1, { records: "three" }))]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    const kept = (await readdir(join(ws.handoffsDir, "spec-analyst"))).sort();
    expect([roles.requests.length, roles.requests[1]?.message.includes("Your previous handoff was rejected: missing_frontmatter"), kept, published]).toEqual([
      2,
      true,
      ["handoff.md.rejected-1", "handoff.md.rejected-2"],
      [{ type: "spec.blocked", producer: "spec-analyst", payload: { reason: "analyst_blocked", detail: "unparseable_handoff: records must be a mapping of integer counts" } }],
    ]);
  });

  // @covers spec-stage:BEH-001
  it("refuses analyst reads under src/ and reads of handoffs while allowing the source spec and spec/", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const replies: unknown[] = [];
    const roles = scriptedRoles([
      async (request) => {
        const read = toolNamed(request.tools, "read_file");
        replies.push(await read.invoke({ path: "src/index.ts" }), await read.invoke({ path: join(ws.handoffsDir, "spec-critic", "handoff.md") }), await read.invoke({ path: ws.specSourcePath }), await read.invoke({ path: "spec/spec.md" }));
        await writeText(handoffPath(ws), analystHandoff(1));
      },
    ]);
    const { context } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect(replies).toEqual([
      "ERROR: path src/index.ts is outside what this role is allowed to read",
      `ERROR: path ${join(ws.handoffsDir, "spec-critic", "handoff.md")} is outside what this role is allowed to read`,
      "# todo-cli\n\n`todo add <text>` stores an item.\n",
      CLI_SPEC,
    ]);
  });

  it("lets the analyst write spec/spec.md and its handoff but nothing under src/", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const replies: unknown[] = [];
    const roles = scriptedRoles([
      async (request) => {
        const write = toolNamed(request.tools, "write_file");
        replies.push(await write.invoke({ path: "spec/spec.md", content: "rewritten" }), await write.invoke({ path: "src/index.ts", content: "hack" }), await write.invoke({ path: handoffPath(ws), content: analystHandoff(1) }));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([replies[1], await readFile(ws.specPath, "utf8"), published[0]?.type]).toEqual(["ERROR: path src/index.ts is outside what this role is allowed to write", "rewritten", "spec.drafted"]);
  });

  // @covers spec-stage:SCN-001
  it("blocks the stage with stage_timeout when the wall-clock budget expires before the analyst answers", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => new Promise<void>(() => undefined)]);
    const config = { ...DEFAULT_CONFIG, timeouts: { ...DEFAULT_CONFIG.timeouts, specStageMs: 20 } };
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    void runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, sliceContext(ws, roles, config), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(published).toEqual([{ type: "spec.blocked", producer: "foreman", payload: { reason: "analyst_blocked", detail: "stage_timeout: spec stage exceeded 20 ms" } }]);
  });

  it("rejects a source spec outside the repository root before invoking the analyst", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([]);
    const slice = { ...sliceContext(ws, roles), paths: { ...sliceContext(ws, roles).paths, specSourcePath: "/elsewhere/source.md" } };
    const { context } = effectContext(runStateAt("spec_drafting"));

    await expect(runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, slice, { commands: scriptedCommands(() => exitZero()), clock: createStageClock() })).rejects.toThrow("must live inside the repository root");
  });
});
