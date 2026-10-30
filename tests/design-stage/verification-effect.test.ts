import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  // @covers design-stage:DLT-007
  it("refuses the designer's read of design/tech.md without counting it as a violation", async () => {
    let refusal = "";
    const peek: RoleScript = async (request) => {
      refusal = await readVia(request, "design/tech.md");
    };
    const h = await harness({ scripts: { "verification-designer": [designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]), peek)] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([refusal, h.roleCalls.length, h.published.map((event) => event.type)]).toEqual(["ERROR: path design/tech.md is outside what this role is allowed to read", 1, ["design.verification.ready"]]);
  });

  // @covers design-stage:DLT-007
  it("refuses the designer's read of the source spec", async () => {
    let refusal = "";
    const peek: RoleScript = async (request) => {
      refusal = await readVia(request, h.slice.paths.specSourcePath);
    };
    const h = await harness({ scripts: { "verification-designer": [designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]), peek)] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect(refusal).toBe(`ERROR: path ${h.slice.paths.specSourcePath} is outside what this role is allowed to read`);
  });

  // @covers design-stage:DLT-007
  it("re-runs the designer once with the firewall note after it read design/tech.md content, then accepts a clean run", async () => {
    const peek: RoleScript = async (request) => {
      await readVia(request, "design/notes.md");
    };
    const complete = verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]);
    const h = await harness({ scripts: { "verification-designer": [designerWriting(complete, peek), designerWriting(complete)] } });
    await mkdir(join(h.productDir, "design"), { recursive: true });
    await writeFile(join(h.productDir, "design", "tech.md"), "# tech\n", "utf8");
    await symlink("tech.md", join(h.productDir, "design", "notes.md"));

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.roleCalls[1]?.message.includes("you read design/tech.md, which this role never reads; continue without it"), h.published.map((event) => [event.type, event.payload["handoffReruns"]])]).toEqual([2, true, [["design.verification.ready", 1]]]);
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

  // @covers design-stage:DLT-001
  // @covers design-stage:CTR-002
  it("re-runs the designer once with the parser message when the file does not parse, then accepts a valid file", async () => {
    const broken = designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"], "notes: 'it isn't yaml'"));
    const h = await harness({ scripts: { "verification-designer": [broken, designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]))] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.roleCalls[1]?.message.includes("- rework_finding: block todo-cli:CTR-001: yaml invalid:"), h.published.map((event) => event.type)]).toEqual([2, true, ["design.verification.ready"]]);
  });

  // @covers design-stage:DLT-001
  it("blocks the design with verification_md_invalid when the second file does not parse either", async () => {
    const broken = designerWriting(verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"], "notes: 'it isn't yaml'"));
    const h = await harness({ scripts: { "verification-designer": [broken, broken, broken] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["reason"], String(event.payload["detail"]).startsWith("block todo-cli:CTR-001: yaml invalid:")])]).toEqual([2, [["design.blocked", "verification_md_invalid", true]]]);
  });

  // @covers design-stage:DLT-001
  it("blocks the design with verification_md_invalid when both files have no blocks", async () => {
    const empty: RoleScript = async (request) => {
      await writeVia(request, "design/verification.md", "# Verification design: todo-cli\n## 3. Blocks\nnone\n");
      await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
    };
    const h = await harness({ scripts: { "verification-designer": [empty, empty] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["reason"]])]).toEqual([2, [["design.blocked", "verification_md_invalid"]]]);
  });

  // @covers design-stage:DLT-001
  it("blocks the design at once when the designer never wrote the file", async () => {
    const onlyHandoff: RoleScript = async (request) => {
      await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
    };
    const h = await harness({ scripts: { "verification-designer": [onlyHandoff, onlyHandoff] } });

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), h.slice, h.commandRunner);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])]).toEqual([1, [["design.blocked", "verification_md_invalid", "design/verification.md was not written"]]]);
  });
});
