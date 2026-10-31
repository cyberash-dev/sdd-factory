import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runAssumeFindings } from "../../src/spec-stage/application/assume-findings.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { CommandResult } from "../../src/spec-stage/ports/command-runner.js";
import { approvalReplies, CLI_SPEC, effectContext, gaReview, OPERATOR, runStateAt, scriptedCommands, scriptedRoles, sliceContext, stageWorkspace, writeText } from "./harness.js";

const FINALIZED: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo-cli:SUR-001","todo-cli:CTR-001","todo-cli:OQ-001","todo-cli:ASM-001"],"files_changed":["spec/spec.md"],"archived_path":"x"}\n', stderr: "" };

const FINAL_ROUND_FINDINGS = [
  "- id: GA-001",
  "  kind: gap",
  "  target_ids: [todo-cli:CTR-001]",
  "  resolution: decide",
  "  required_change: add error_taxonomy with E_USAGE",
  "  applied: no",
  "- id: GA-002",
  "  kind: conflict",
  "  target_ids: [todo-cli:BEH-001, todo-cli:INV-001]",
  "  resolution: decide",
  "  required_change: |",
  "    allocate ids as the smallest integer greater than every id ever used",
  "  applied: no",
  "- id: GA-003",
  "  kind: gap",
  "  target_ids: [todo-cli:CTR-001]",
  "  resolution: assume",
  "  required_change: none",
  "  applied: yes",
].join("\n");

const ASSUMPTIONS_SKELETON = "# todo-cli assumptions (sandbox)\n\n---\n\n## 1. Context\n\nnone\n\n---\n\n## 18. Assumptions\n\nnone\n\n---\n\n## 19. Out of scope\n\nnone\n";

describe("spec.assume_findings effect", () => {
  // @covers spec-stage:DLT-001
  // @covers spec-stage:BEH-002
  it("records every open finding of the final round as a sandbox assumption, leaves spec.md untouched and approves the spec", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(ws.gaPath, gaReview(2, "rework", FINAL_ROUND_FINDINGS));
    await writeText(ws.assumptionsPath, ASSUMPTIONS_SKELETON);
    const commands = scriptedCommands(approvalReplies([{ id: "todo-cli:SUR-001", file: "spec/spec.md" }], { finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runAssumeFindings({ kind: "spec.assume_findings", round: 2, findingsPath: "spec/review/ga.md" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const assumptions = await readFile(ws.assumptionsPath, "utf8");
    expect([
      published,
      (await readFile(ws.specPath, "utf8")) === CLI_SPEC,
      assumptions.includes("id: todo-cli:ASM-002"),
      assumptions.includes("id: todo-cli:ASM-003"),
      assumptions.includes("id: todo-cli:ASM-004"),
      assumptions.includes("critic finding GA-001 (gap; targets todo-cli:CTR-001) of round 2"),
      assumptions.includes("  allocate ids as the smallest integer greater than every id ever used"),
      assumptions.includes("## 18. Assumptions\n\nnone"),
      commands.calls.map((call) => call[0]),
    ]).toEqual([[{ type: "spec.approved", producer: "foreman", payload: { approver: OPERATOR, mode: "pre-authorized-at-launch", approvedIds: 4 } }], true, true, true, false, true, true, false, ["lint", "lint", "record", "approve", "finalize", "ready", "approve", "finalize", "record", "lint"]]);
  });

  it("approves without creating the assumptions file when the final round left no open finding", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(ws.gaPath, gaReview(2, "rework", "[]"));
    const commands = scriptedCommands(approvalReplies([{ id: "todo-cli:SUR-001", file: "spec/spec.md" }], { finalize: FINALIZED }));
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runAssumeFindings({ kind: "spec.assume_findings", round: 2, findingsPath: "spec/review/ga.md" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([published.map((event) => event.type), existsSync(ws.assumptionsPath), commands.calls.map((call) => call[0])]).toEqual([["spec.approved"], false, ["lint", "record", "approve", "finalize", "ready", "approve", "finalize", "record", "lint"]]);
  });
});
