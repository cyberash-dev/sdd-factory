import { describe, expect, it } from "vitest";
import { runApprove } from "../../src/spec-stage/application/approve.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import { approvalReplies, CLI_SPEC, effectContext, OPERATOR, RUN_ID, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace } from "../spec-stage/harness.js";

const READY_CLEAN = { exitCode: 0, stdout: JSON.stringify({ format_version: 1, ok: true, violations: [] }), stderr: "" };

const FINALIZED = { exitCode: 0, stdout: JSON.stringify({ format_version: 1, ok: true, finalized_ids: ["todo-cli:SUR-001", "todo-cli:CTR-001", "todo-cli:BL-001"] }), stderr: "" };

describe("pre-authorised approval executed by the foreman", () => {
  // @covers factory:BEH-003
  it("approves every product record with the operator identity, product-owner role and the launch change request", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const records = [
      { id: "todo-cli:SUR-001", file: "spec/spec.md" },
      { id: "todo-cli:CTR-001", file: "spec/spec.md" },
      { id: "todo-cli:BL-001", file: "spec/spec.md" },
    ];
    const commands = scriptedCommands(approvalReplies(records, { finalize: FINALIZED, ready: READY_CLEAN }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const approveCalls = commands.calls.filter((argv) => argv[0] === "approve");
    expect([
      approveCalls.map((argv) => argv[2]),
      approveCalls.every((argv) => argv.includes("--approver") && argv[argv.indexOf("--approver") + 1] === OPERATOR),
      approveCalls.every((argv) => argv[argv.indexOf("--owner-role") + 1] === "product-owner"),
      approveCalls.every((argv) => argv[argv.indexOf("--change-request") + 1] === `${RUN_ID}: pre-authorised at launch`),
      published.map((event) => [event.type, event.payload["approver"], event.payload["mode"], event.payload["approvedIds"]]),
    ]).toEqual([["todo-cli:SUR-001", "todo-cli:CTR-001", "todo-cli:BL-001", "todo-cli:SUR-001", "todo-cli:CTR-001", "todo-cli:BL-001"], true, true, true, [["spec.approved", OPERATOR, "pre-authorized-at-launch", 3]]]);
  });

  // @covers spec-stage:DLT-011
  it("reports a finalize refusing proposed references to the gate instead of approving", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ finalize: { exitCode: 1, stdout: JSON.stringify({ format_version: 1, ok: false, reason: "proposed-references" }), stderr: "" } }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect(published.map((event) => [event.type, event.payload["findingsPath"]])).toEqual([["spec.gate_failed", "spec/review/gate.md"]]);
  });
});
