import { describe, expect, it } from "vitest";
import { runVerificationEffect } from "../../src/design-stage/application/verification-effect.js";
import { handoffPathIn, handoffText, harness, readVia, stateIn, VERIFICATION_HANDOFF_LINES, verificationMdText, writeVia, type RoleScript } from "./harness.js";

function designerWriting(verificationMd: string, before: RoleScript = async () => undefined): RoleScript {
  return async (request) => {
    await before(request);
    await readVia(request, "spec/spec.md");
    await writeVia(request, "design/verification.md", verificationMd);
    await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
  };
}

describe("design.verification effect", () => {
  // @covers design-stage:BEH-001
  // @covers design-stage:CTR-002
  it("publishes design.verification.ready when every approved obligation-bearing id has a block", async () => {
    const h = await harness({ scripts: { "verification-designer": [designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]))] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["path"]])]).toEqual([1, [["design.verification.ready", "design/verification.md"]]]);
  });

  // @covers design-stage:BEH-001
  it("blocks the design with context_firewall_violation when the designer reads design/tech.md", async () => {
    const peek: RoleScript = async (request) => {
      await readVia(request, "design/tech.md");
    };
    const h = await harness({ scripts: { "verification-designer": [designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]), peek)] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])).toEqual([["design.blocked", "context_firewall_violation", "verification-designer read design/tech.md"]]);
  });

  it("blocks the design with context_firewall_violation when the designer reads the source spec", async () => {
    const peek: RoleScript = async (request) => {
      await readVia(request, h.slice.paths.specSourcePath);
    };
    const h = await harness({ scripts: { "verification-designer": [designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]), peek)] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect(h.published.map((event) => event.payload["reason"])).toEqual(["context_firewall_violation"]);
  });

  // @covers design-stage:CTR-002
  it("re-runs the designer once naming the missing block, then accepts a complete file", async () => {
    const h = await harness({ scripts: { "verification-designer": [designerWriting(verificationMdText(["todo-cli:CTR-001"])), designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]))] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.roleCalls[1]?.message.includes("- attempt: 2"), h.roleCalls[1]?.message.includes("- rework_finding: missing_block: todo-cli:BEH-002"), h.published.map((event) => event.type)]).toEqual([2, true, true, ["design.verification.ready"]]);
  });

  // @covers design-stage:CTR-002
  it("blocks the design with verification_incomplete when the block is still missing after the re-run", async () => {
    const incomplete = designerWriting(verificationMdText(["todo-cli:CTR-001"]));
    const h = await harness({ scripts: { "verification-designer": [incomplete, incomplete, incomplete] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])]).toEqual([2, [["design.blocked", "verification_incomplete", "missing_block: todo-cli:BEH-002"]]]);
  });

  // @covers design-stage:CTR-002
  it("treats a block naming a src path as a rework finding", async () => {
    const leaking = designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"], 'notes: "see src/cli/parse.ts"'));
    const h = await harness({ scripts: { "verification-designer": [leaking, designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]))] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls[1]?.message.includes("block_references_file_path: todo-cli:CTR-001 (src/cli/parse.ts)"), h.published.map((event) => event.type)]).toEqual([true, ["design.verification.ready"]]);
  });

  it("blocks the design with verification_md_invalid when the file has no blocks", async () => {
    const empty: RoleScript = async (request) => {
      await writeVia(request, "design/verification.md", "# Verification design: todo-cli\n## 3. Blocks\nnone\n");
      await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
    };
    const h = await harness({ scripts: { "verification-designer": [empty] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.blocked", "verification_md_invalid"]]);
  });
});
