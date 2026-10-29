import { describe, expect, it } from "vitest";
import { runApprove } from "../../src/spec-stage/application/approve.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { CommandResult } from "../../src/spec-stage/ports/command-runner.js";
import { CLI_SPEC, effectContext, exitZero, OPERATOR, RUN_ID, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace } from "./harness.js";

const FINALIZED: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","finalized_ids":["todo-cli:SUR-001","todo-cli:CTR-001","todo-cli:OQ-001","todo-cli:ASM-001"],"files_changed":["spec/spec.md"],"archived_path":"x"}\n', stderr: "" };

const APPROVE_FLAGS = ["--approver", OPERATOR, "--owner-role", "product-owner", "--change-request", `${RUN_ID}: pre-authorised at launch`, "--scope", "first-time-approval", "--format=json"];

describe("spec.approve effect", () => {
  it("runs lint, approve glob, approve baseline, finalize and lint again, then publishes spec.approved with the flipped count", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls, published]).toEqual([
      [
        ["lint", "--format=json"],
        ["approve", "--id", "todo-cli:*", ...APPROVE_FLAGS],
        ["approve", "--id", "todo-cli:BL-001", ...APPROVE_FLAGS],
        ["finalize", "--format=json"],
        ["lint", "--format=json"],
      ],
      [{ type: "spec.approved", producer: "foreman", payload: { approver: OPERATOR, mode: "pre-authorized-at-launch", approvedIds: 4 } }],
    ]);
  });

  it("ignores no-id-match on the baseline approval when the glob already covered it", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands((argv) => {
      if (argv[0] === "approve" && argv[2] === "todo-cli:BL-001") {
        return { exitCode: 1, stdout: '{"format_version":1,"ok":false,"reason":"no-id-match","detail":"no normative ID records matched"}\n', stderr: "" };
      }
      return argv[0] === "finalize" ? FINALIZED : exitZero();
    });
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect(published.map((event) => event.type)).toEqual(["spec.approved"]);
  });

  it("blocks with finalize_failed and the CLI output when finalize refuses proposed references", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ finalize: { exitCode: 1, stdout: '{"ok":false,"reason":"proposed-references"}', stderr: "" } }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls.length, published]).toEqual([4, [{ type: "spec.blocked", producer: "foreman", payload: { reason: "analyst_blocked", detail: 'finalize_failed: {"ok":false,"reason":"proposed-references"}' } }]]);
  });

  it("blocks with lint_failed before approving anything when lint is red", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: "", stderr: "sdd:weasel-word at line 9" } }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls.length, published]).toEqual([1, [{ type: "spec.blocked", producer: "foreman", payload: { reason: "analyst_blocked", detail: "lint_failed: sdd:weasel-word at line 9" } }]]);
  });

  // @covers spec-stage:INV-001
  it("never approves a spec whose open question has no deciding assumption", async () => {
    const ws = await stageWorkspace(CLI_SPEC.replace("source_open_q: todo-cli:OQ-001", "source_open_q: null"));
    const commands = scriptedCommands(sddReplies({ finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls.map((argv) => argv[0]), published]).toEqual([["lint"], [{ type: "spec.blocked", producer: "foreman", payload: { reason: "analyst_blocked", detail: "spec_integrity: todo-cli:OQ-001 is referenced by 0 ASSUMPTION records, expected 1" } }]]);
  });

  // @covers spec-stage:CTR-001
  it("never approves a spec with a contract outside the surface members", async () => {
    const ws = await stageWorkspace(CLI_SPEC.replace("members: [todo-cli:CTR-001]", "members: []"));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands: scriptedCommands(sddReplies({ finalize: FINALIZED })), clock: createStageClock() });

    expect(published[0]?.payload["detail"]).toBe("spec_integrity: todo-cli:CTR-001 is not a member of todo-cli:SUR-001");
  });

  it("blocks when lint fails after finalize", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands((argv, call) => (argv[0] === "finalize" ? FINALIZED : argv[0] === "lint" && call === 5 ? { exitCode: 1, stdout: "", stderr: "approval_record invalid" } : exitZero()));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect(published[0]?.payload["detail"]).toBe("lint_failed_after_finalize: approval_record invalid");
  });
});
