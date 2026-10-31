import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runApprove } from "../../src/spec-stage/application/approve.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { CommandResult } from "../../src/spec-stage/ports/command-runner.js";
import { approvalReplies, CLI_SPEC, effectContext, exitZero, OPERATOR, RUN_ID, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText } from "./harness.js";

const FINALIZED: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo-cli:SUR-001","todo-cli:CTR-001","todo-cli:OQ-001","todo-cli:ASM-001"],"files_changed":["spec/spec.md"],"archived_path":"x"}\n', stderr: "" };

function lintWithErrors(errorCount: number): CommandResult {
  const diagnostics = Array.from({ length: errorCount }, (_, index) => ({ severity: "error", rule: "sdd:required-field", file: "spec/spec.md", line: index + 1, message: "missing field" }));
  return { exitCode: errorCount === 0 ? 0 : 1, stdout: JSON.stringify({ format_version: 1, ok: errorCount === 0, error_count: errorCount, warn_count: 0, diagnostics }), stderr: "" };
}

const APPROVE_FLAGS = ["--approver", OPERATOR, "--owner-role", "product-owner", "--change-request", `${RUN_ID}: pre-authorised at launch`, "--scope", "first-time-approval", "--format=json"];

describe("spec.approve effect", () => {
  it("runs lint, one approve per proposed record, finalize, record list and lint again, then publishes spec.approved with the flipped count", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const records = [
      { id: "todo-cli:SUR-001", file: "spec/spec.md" },
      { id: "todo-cli:CTR-001", file: "spec/spec.md" },
      { id: "todo-cli:OQ-001", file: "spec/spec.md" },
      { id: "todo-cli:ASM-001", file: "spec/spec.md" },
    ];
    const commands = scriptedCommands(approvalReplies(records, { finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls, published]).toEqual([
      [
        ["lint", "--format=json"],
        ["record", "list", "--format=json"],
        ["approve", "--id", "todo-cli:SUR-001", ...APPROVE_FLAGS],
        ["approve", "--id", "todo-cli:CTR-001", ...APPROVE_FLAGS],
        ["approve", "--id", "todo-cli:OQ-001", ...APPROVE_FLAGS],
        ["approve", "--id", "todo-cli:ASM-001", ...APPROVE_FLAGS],
        ["finalize", "--format=json"],
        ["ready", "--format=json"],
        ["approve", "--id", "todo-cli:SUR-001", ...APPROVE_FLAGS],
        ["approve", "--id", "todo-cli:CTR-001", ...APPROVE_FLAGS],
        ["approve", "--id", "todo-cli:OQ-001", ...APPROVE_FLAGS],
        ["approve", "--id", "todo-cli:ASM-001", ...APPROVE_FLAGS],
        ["finalize", "--format=json"],
        ["record", "list", "--format=json"],
        ["lint", "--format=json"],
      ],
      [{ type: "spec.approved", producer: "foreman", payload: { approver: OPERATOR, mode: "pre-authorized-at-launch", approvedIds: 4 } }],
    ]);
  });

  it("ignores no-id-match on the baseline approval", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const noIdMatch: CommandResult = { exitCode: 1, stdout: '{"format_version":1,"ok":false,"reason":"no-id-match","detail":"no normative ID records matched"}\n', stderr: "" };
    const replies = approvalReplies([{ id: "todo-cli:SUR-001", file: "spec/spec.md" }, { id: "todo-cli:BL-001", file: "spec/spec.md" }], { finalize: FINALIZED });
    const commands = scriptedCommands((argv, call, cwd) => (argv[2] === "todo-cli:BL-001" ? noIdMatch : replies(argv, call, cwd)));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect(published.map((event) => event.type)).toEqual(["spec.approved"]);
  });

  // @covers spec-stage:DLT-011
  it("reports finalize_failed with the CLI output to the gate when finalize refuses proposed references", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const refused: CommandResult = { exitCode: 1, stdout: '{"format_version":1,"ok":false,"reason":"proposed-references"}', stderr: "" };
    const commands = scriptedCommands((argv, call) => (argv[0] === "finalize" ? (call === 3 ? FINALIZED : refused) : sddReplies({})(argv)));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls.length, published]).toEqual([5, [{ type: "spec.gate_failed", producer: "foreman", payload: { findingsPath: "spec/review/gate.md", detail: 'finalize_failed: {"format_version":1,"ok":false,"reason":"proposed-references"}' } }]]);
  });

  // @covers spec-stage:DLT-011
  it("reports lint_failed to the gate before approving anything when lint is red", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: "", stderr: "sdd:weasel-word at line 9" } }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls.length, published]).toEqual([1, [{ type: "spec.gate_failed", producer: "foreman", payload: { findingsPath: "spec/review/gate.md", detail: "lint_failed: sdd:weasel-word at line 9" } }]]);
  });

  // @covers spec-stage:INV-001
  // @covers spec-stage:DLT-003
  it("decides an open question nobody decided by its default before approving, so no undecided question reaches approval", async () => {
    const ws = await stageWorkspace(CLI_SPEC.replace("source_open_q: todo-cli:OQ-001", "source_open_q: null"));
    const commands = scriptedCommands(sddReplies({ finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const spec = await readFile(ws.specPath, "utf8");
    expect([
      published.map((event) => event.type),
      spec.includes("id: todo-cli:ASM-002"),
      spec.includes("source_open_q: todo-cli:OQ-001"),
      spec.includes("todo-cli:OQ-001: resolved by its default option `a`"),
      spec.includes("default_if_unresolved of todo-cli:OQ-001 materialised by the foreman at approval"),
    ]).toEqual([["spec.approved"], true, true, true, true]);
  });

  // @covers spec-stage:DLT-003
  // @covers spec-stage:DLT-011
  it("still refuses approval on a blocking open question and reports it to the gate", async () => {
    const ws = await stageWorkspace(CLI_SPEC.replace("blocking: no\ndefault_if_unresolved: a", "blocking: yes\ndefault_if_unresolved: a"));
    const commands = scriptedCommands(sddReplies({ finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([commands.calls.map((argv) => argv[0]), published[0]?.type, String(published[0]?.payload["detail"]).startsWith("spec_integrity: todo-cli:OQ-001 is blocking")]).toEqual([["lint"], "spec.gate_failed", true]);
  });

  // @covers spec-stage:CTR-001
  // @covers spec-stage:DLT-004
  it("adds a contract missing from the surface members before lint and approves the repaired spec", async () => {
    const ws = await stageWorkspace(CLI_SPEC.replace("members: [todo-cli:CTR-001]", "members: []"));
    const commands = scriptedCommands(sddReplies({ finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const spec = await readFile(ws.specPath, "utf8");
    expect([published.map((event) => event.type), commands.calls[0]?.[0], spec.includes("members:\n  - todo-cli:CTR-001\nversion: \"0.1.0\"")]).toEqual([["spec.approved"], "lint", true]);
  });

  // @covers spec-stage:DLT-009
  it("reverts the surface members repair that raises the lint error count and logs the counts", async () => {
    const unrepaired = CLI_SPEC.replace("members: [todo-cli:CTR-001]", "members: []");
    const ws = await stageWorkspace(unrepaired);
    const logged: string[] = [];
    const commands = scriptedCommands((argv) => (argv[0] === "lint" ? lintWithErrors(readFileSync(ws.specPath, "utf8") === unrepaired ? 0 : 4) : exitZero()));
    const { context } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, { ...sliceContext(ws, scriptedRoles([])), log: (line) => logged.push(line) }, { commands, clock: createStageClock() });

    expect([(await readFile(ws.specPath, "utf8")) === unrepaired, logged.filter((line) => line.includes("reverted"))]).toEqual([true, ["spec.approve: surface members reverted: lint errors 0 -> 4"]]);
  });

  // @covers spec-stage:DLT-004
  // @covers spec-stage:DLT-011
  it("still refuses approval with spec_integrity when the spec holds two surfaces and reports it to the gate", async () => {
    const secondSurface = CLI_SPEC.slice(CLI_SPEC.indexOf("```yaml"), CLI_SPEC.indexOf("## 7.")).replace("todo-cli:SUR-001", "todo-cli:SUR-002");
    const ws = await stageWorkspace(CLI_SPEC.replace("## 7. Data contracts", `${secondSurface}\n## 7. Data contracts`));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands: scriptedCommands(sddReplies({ finalize: FINALIZED })), clock: createStageClock() });

    expect([published[0]?.type, String(published[0]?.payload["detail"]).startsWith("spec_integrity: expected exactly one Surface, found 2")]).toEqual(["spec.gate_failed", true]);
  });

  it("blocks when lint fails after finalize", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands((argv, call) => (argv[0] === "lint" && call === 7 ? { exitCode: 1, stdout: "", stderr: "approval_record invalid" } : sddReplies({ finalize: FINALIZED })(argv)));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect(published[0]?.payload["detail"]).toBe("lint_failed_after_finalize: approval_record invalid");
  });
  // @covers spec-stage:DLT-013
  it("queues one approval per proposed record of both spec files, BL-001 included, and publishes spec.approved with the flipped count", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const records = [
      { id: "todo-cli:SUR-001", file: "spec/spec.md" },
      { id: "todo-cli:CTR-001", file: "spec/spec.md" },
      { id: "todo-cli:BL-001", file: "spec/spec.md" },
      { id: "todo-cli:ASM-002", file: "spec/assumptions.md" },
    ];
    const finalized: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"flipped":["todo-cli:SUR-001","todo-cli:CTR-001","todo-cli:BL-001","todo-cli:ASM-002"]}\n', stderr: "" };
    const commands = scriptedCommands(approvalReplies(records, { finalize: finalized }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const approvals = [
      ["approve", "--id", "todo-cli:SUR-001", ...APPROVE_FLAGS],
      ["approve", "--id", "todo-cli:CTR-001", ...APPROVE_FLAGS],
      ["approve", "--id", "todo-cli:BL-001", ...APPROVE_FLAGS],
      ["approve", "--id", "todo-cli:ASM-002", ...APPROVE_FLAGS],
    ];
    expect([commands.calls.filter((argv) => argv[0] === "approve"), published]).toEqual([
      [...approvals, ...approvals],
      [{ type: "spec.approved", producer: "foreman", payload: { approver: OPERATOR, mode: "pre-authorized-at-launch", approvedIds: 4 } }],
    ]);
  });

  // @covers spec-stage:DLT-013
  it("fails the gate naming the spec.md record finalize left proposed, ignores the sandbox one and does not publish spec.approved", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(join(ws.productDir, ".sdd", "config.json"), '{"partitions":{"todo-cli":{"spec_paths":["spec/spec.md","spec/assumptions.md"],"sandbox_paths":["spec/assumptions.md"]}}}\n');
    const records = [
      { id: "todo-cli:SUR-001", file: "spec/spec.md" },
      { id: "todo-cli:CTR-001", file: "spec/spec.md" },
      { id: "todo-cli:ASM-002", file: "spec/assumptions.md" },
    ];
    const commands = scriptedCommands(approvalReplies(records, { finalize: FINALIZED }, ["todo-cli:CTR-001", "todo-cli:ASM-002"]));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect(published).toEqual([{ type: "spec.gate_failed", producer: "foreman", payload: { findingsPath: "spec/review/gate.md", detail: "left_proposed_after_finalize: todo-cli:CTR-001" } }]);
  });
});
