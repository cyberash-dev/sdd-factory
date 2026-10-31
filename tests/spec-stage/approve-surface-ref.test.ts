import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runApprove } from "../../src/spec-stage/application/approve.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { CommandResult } from "../../src/spec-stage/ports/command-runner.js";
import { CLI_SPEC, effectContext, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace } from "./harness.js";

const FINALIZED: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo-cli:SUR-001"],"files_changed":["spec/spec.md"],"archived_path":"x"}\n', stderr: "" };

function record(id: string, type: string, body: string): string {
  return `\`\`\`yaml\n---\nid: ${id}\ntype: ${type}\nlifecycle: {status: proposed}\npartition_id: todo-cli\n${body}\n---\n\`\`\`\n`;
}

describe("spec.approve surface_ref membership", () => {
  // @covers spec-stage:DLT-007
  // @covers spec-stage:BEH-004
  it("appends the records whose surface_ref names the surface in record order and skips a behavior without surface_ref", async () => {
    const boundaryFields = "policy_refs: {not_applicable: local cli}\napplicability: {invariant_to_all_axes: true}\nconcurrency_model: {not_applicable: single process}\ndata_scope: {not_applicable: no persistent state}";
    const behaviors = [
      record("todo-cli:BEH-001", "Behavior", `title: add\nsurface_ref: todo-cli:SUR-001\n${boundaryFields}`),
      record("todo-cli:BEH-002", "Behavior", "title: internal"),
      record("todo-cli:SCN-001", "Scenario", `title: add then list\nsurface_ref: todo-cli:SUR-001\n${boundaryFields}`),
      record("todo-cli:BEH-003", "Behavior", `title: list\nsurface_ref: todo-cli:SUR-001\n${boundaryFields}`),
    ].join("\n");
    const ws = await stageWorkspace(`${CLI_SPEC}\n## 8. Behaviors\n${behaviors}`);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands: scriptedCommands(sddReplies({ finalize: FINALIZED, ready: { exitCode: 0, stdout: '{"format_version":1,"ok":true,"violations":[]}\n', stderr: "" } })), clock: createStageClock() });

    const spec = await readFile(ws.specPath, "utf8");
    expect([published.map((event) => event.type), spec.includes('members:\n  - todo-cli:CTR-001\n  - todo-cli:BEH-001\n  - todo-cli:SCN-001\n  - todo-cli:BEH-003\nversion: "0.1.0"')]).toEqual([["spec.approved"], true]);
  });
});
