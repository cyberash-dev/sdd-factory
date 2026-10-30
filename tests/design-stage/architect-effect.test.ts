import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runArchitectEffect } from "../../src/design-stage/application/architect-effect.js";
import { ApiRoleTimeoutError } from "../../src/shared/llm/api-role-runner.js";
import { ARCHITECT_HANDOFF_LINES, handoffPathIn, handoffText, harness, readVia, stateIn, techMdText, writeVia, type RoleScript } from "./harness.js";

function architectWriting(techMd: string, handoffLines: readonly string[] = ARCHITECT_HANDOFF_LINES, before: RoleScript = async () => undefined): RoleScript {
  return async (request) => {
    await before(request);
    await readVia(request, "spec/spec.md");
    await writeVia(request, "design/tech.md", techMd);
    await writeVia(request, handoffPathIn(request), handoffText("architect", 1, handoffLines));
  };
}

/* The deny-list refuses a forbidden path, so a forbidden read can only get content through a link to it. */
async function linkInDesign(productDir: string, link: string, target: string, content: string): Promise<void> {
  await mkdir(join(productDir, "design"), { recursive: true });
  await writeFile(join(productDir, "design", target), content, "utf8");
  await symlink(target, join(productDir, "design", link));
}

describe("design.architect effect", () => {
  // @covers design-stage:BEH-001
  it("publishes design.tech.ready with the file path once tech.md parses and the handoff is complete", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText({ devDependencies: ["typescript@7.0.2"] }))] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["path"], event.payload["specIds"], event.payload["handoffReruns"]])).toEqual([["design.tech.ready", "design/tech.md", [], 0]]);
  });

  it("renders the invocation inputs into the first message with absolute spec source and handoff paths", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText())] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    const message = h.roleCalls[0]?.message ?? "";
    expect([message.includes("- slug: todo-cli"), message.includes(`- product_dir: ${h.productDir}`), message.includes(`- spec_source_path: ${h.slice.paths.specSourcePath}`), message.includes(`- handoff_path: ${join(h.slice.paths.handoffsDir, "architect", "handoff.md")}`), message.includes("- attempt: 1"), h.roleCalls[0]?.instruction]).toEqual([true, true, true, true, true, "instruction for architect"]);
  });

  it("lets the architect read the source spec outside the product directory and refuses a write outside its own files", async () => {
    let sourceText = "";
    let refusal = "";
    const probing = architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, async (request) => {
      sourceText = await readVia(request, h.slice.paths.specSourcePath);
      refusal = String(await request.tools.find((candidate) => candidate.name === "write_file")?.invoke({ path: "src/index.ts", content: "x" }));
    });
    const h = await harness({ scripts: { architect: [probing] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([sourceText, refusal.startsWith("ERROR: path src/index.ts is outside"), h.published.map((event) => event.type)]).toEqual(["# organisers spec\nintent only\n", true, ["design.tech.ready"]]);
  });

  // @covers design-stage:DLT-003
  it("lets the architect read the scaffolded tooling files", async () => {
    let packageJson = "";
    let tsconfig = "";
    const peek: RoleScript = async (request) => {
      packageJson = await readVia(request, "package.json");
      tsconfig = await readVia(request, "tsconfig.json");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek)] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([packageJson.includes('"name":"todo-cli"'), tsconfig.includes('"compilerOptions"'), h.published.map((event) => event.type)]).toEqual([true, true, ["design.tech.ready"]]);
  });

  // @covers design-stage:BEH-001
  // @covers design-stage:DLT-007
  it("refuses a first-pass architect's read of design/verification.md without counting it as a violation", async () => {
    let refusal = "";
    const peek: RoleScript = async (request) => {
      refusal = await readVia(request, "./design/verification.md");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek)] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([refusal, h.roleCalls.length, h.published.map((event) => event.type)]).toEqual(["ERROR: path ./design/verification.md is outside what this role is allowed to read", 1, ["design.tech.ready"]]);
  });

  // @covers design-stage:DLT-007
  it("publishes design.tech.ready without a rerun when the architect's list_dir of src was refused", async () => {
    let refusal = "";
    const listing: RoleScript = async (request) => {
      refusal = String(await request.tools.find((candidate) => candidate.name === "list_dir")?.invoke({ path: "src" }));
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, listing)] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([refusal, h.roleCalls.length, h.published.map((event) => event.type)]).toEqual(["ERROR: path src is outside what this role is allowed to list", 1, ["design.tech.ready"]]);
  });

  // @covers design-stage:DLT-007
  it("lets a repairing architect in building read design/plan.md and design/tasks.json and publishes design.tech.ready", async () => {
    let planText = "";
    let tasksText = "";
    const peek: RoleScript = async (request) => {
      planText = await readVia(request, "design/plan.md");
      tasksText = await readVia(request, "design/tasks.json");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek)] } });
    await mkdir(join(h.productDir, "design"), { recursive: true });
    await writeFile(join(h.productDir, "design", "plan.md"), "# plan\n", "utf8");
    await writeFile(join(h.productDir, "design", "tasks.json"), "{}\n", "utf8");

    await runArchitectEffect({ kind: "design.architect", attempt: 2, specIds: ["todo-cli:BEH-002"], reworkFinding: "VD-INFEASIBLE" }, h.context(stateIn("building")), h.slice);

    expect([planText, tasksText, h.roleCalls.length, h.published.map((event) => event.type)]).toEqual(["# plan\n", "{}\n", 1, ["design.tech.ready"]]);
  });

  // @covers design-stage:DLT-007
  it("still refuses design/verification.md to a repairing architect in building", async () => {
    let refusal = "";
    const peek: RoleScript = async (request) => {
      refusal = await readVia(request, "design/verification.md");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek)] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 2, reworkFinding: "VD-INFEASIBLE" }, h.context(stateIn("building")), h.slice);

    expect(refusal).toBe("ERROR: path design/verification.md is outside what this role is allowed to read");
  });

  // @covers design-stage:DLT-007
  it("still refuses design/plan.md to a first-pass architect", async () => {
    let refusal = "";
    const peek: RoleScript = async (request) => {
      refusal = await readVia(request, "design/plan.md");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek)] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(refusal).toBe("ERROR: path design/plan.md is outside what this role is allowed to read");
  });

  // @covers design-stage:DLT-007
  it("re-runs a first-pass architect once with the firewall note after it read design/verification.md content, then accepts a clean run", async () => {
    const peek: RoleScript = async (request) => {
      await readVia(request, "design/notes.md");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek), architectWriting(techMdText())] } });
    await linkInDesign(h.productDir, "notes.md", "verification.md", "# verification\n");

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([h.roleCalls.length, h.roleCalls[1]?.message.includes("you read design/verification.md, which this role never reads; continue without it"), h.published.map((event) => [event.type, event.payload["handoffReruns"]])]).toEqual([2, true, [["design.tech.ready", 1]]]);
  });

  // @covers design-stage:DLT-007
  it("keeps the forbidden file's content out of the architect's rerun message", async () => {
    let readText = "";
    const peek: RoleScript = async (request) => {
      readText = await readVia(request, "design/notes.md");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek), architectWriting(techMdText())] } });
    await linkInDesign(h.productDir, "notes.md", "verification.md", "VERIFICATION-ONLY-ORACLE\n");

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([readText, h.roleCalls.length, h.roleCalls[1]?.message.includes("VERIFICATION-ONLY-ORACLE")]).toEqual(["VERIFICATION-ONLY-ORACLE\n", 2, false]);
  });

  // @covers design-stage:DLT-007
  it("blocks the design with context_firewall_violation when the architect's rerun reads design/verification.md content again", async () => {
    const peek: RoleScript = async (request) => {
      await readVia(request, "design/notes.md");
    };
    const peeking = architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek);
    const h = await harness({ scripts: { architect: [peeking, peeking, peeking] } });
    await linkInDesign(h.productDir, "notes.md", "verification.md", "# verification\n");

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])]).toEqual([2, [["design.blocked", "context_firewall_violation", "architect read design/verification.md"]]]);
  });

  // @covers design-stage:BEH-001
  it("blocks the design with architect_blocked when the handoff reports status blocked", async () => {
    const blocked = ["status: blocked", "modules: []", "tooling: {}", "blocked_reason: spec has no approved record"];
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), blocked)] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])).toEqual([["design.blocked", "architect_blocked", "spec has no approved record"]]);
  });

  // @covers factory:BEH-011
  it("re-runs the architect with the timeout note when its loop exceeds the budget, then accepts the second file", async () => {
    const timingOut: RoleScript = async () => {
      throw new ApiRoleTimeoutError("architect exceeded 1200000 ms");
    };
    const h = await harness({ scripts: { architect: [timingOut, architectWriting(techMdText())] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([h.roleCalls.length, h.roleCalls[1]?.message.includes("without a handoff; continue from the files on disk and write the handoff first"), h.published.map((event) => [event.type, event.payload["handoffReruns"]])]).toEqual([2, true, [["design.tech.ready", 1]]]);
  });

  // @covers factory:BEH-011
  it("blocks the design with architect_timeout when the re-run exceeds the budget too", async () => {
    const timingOut: RoleScript = async () => {
      throw new ApiRoleTimeoutError("architect exceeded 1200000 ms");
    };
    const h = await harness({ scripts: { architect: [timingOut, timingOut, timingOut] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["reason"]])]).toEqual([2, [["design.blocked", "architect_timeout"]]]);
  });

  // @covers factory:BEH-011
  it("uses the handoff the architect wrote before its budget ran out instead of re-running", async () => {
    const writesThenHangs: RoleScript = async (request) => {
      await architectWriting(techMdText())(request);
      throw new ApiRoleTimeoutError("architect exceeded 1200000 ms");
    };
    const h = await harness({ scripts: { architect: [writesThenHangs] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([h.roleCalls.length, h.published.map((event) => event.type)]).toEqual([1, ["design.tech.ready"]]);
  });

  // @covers design-stage:BEH-003
  // @covers design-stage:CTR-001
  it("routes an unpinned dependency to the architect as design.rework", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText({ devDependencies: ["vitest@^5"] }))] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["target"], event.payload["reason"], event.payload["attempt"]])).toEqual([["design.rework", "architect", "unpinned dependency: vitest@^5", 1]]);
  });

  // @covers design-stage:CTR-001
  // @covers design-stage:DLT-001
  it("routes a missing TD-TOOLING section to the architect as design.rework carrying the parser message", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText({ withTooling: false }))] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["target"], event.payload["reason"]])).toEqual([["design.rework", "architect", "missing section: ## TD-TOOLING"]]);
  });

  // @covers design-stage:DLT-001
  it("routes an unparseable TD-TOOLING block to the architect as design.rework carrying the parser message", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText({ tsconfig: "{ strict: [true" }))] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["target"], String(event.payload["reason"]).startsWith("TD-TOOLING yaml invalid:")])).toEqual([["design.rework", "architect", true]]);
  });

  // @covers design-stage:DLT-001
  it("blocks the design with tech_md_invalid when a repair attempt's file does not parse either", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText({ tsconfig: "{ strict: [true" }))] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 2, reworkFinding: "TD-TOOLING yaml invalid: earlier" }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["reason"], String(event.payload["detail"]).startsWith("TD-TOOLING yaml invalid:")])).toEqual([["design.blocked", "tech_md_invalid", true]]);
  });

  // @covers design-stage:DLT-001
  it("blocks the design with tech_md_invalid when the architect never wrote tech.md", async () => {
    const onlyHandoff: RoleScript = async (request) => {
      await writeVia(request, handoffPathIn(request), handoffText("architect", 1, ARCHITECT_HANDOFF_LINES));
    };
    const h = await harness({ scripts: { architect: [onlyHandoff] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.blocked", "tech_md_invalid"]]);
  });

  it("re-runs the architect once with the parse error when the handoff lacks a required key, keeping the rejected file", async () => {
    const withoutModules = async (request: Parameters<RoleScript>[0]): Promise<void> => {
      await writeVia(request, "design/tech.md", techMdText());
      await writeVia(request, handoffPathIn(request), handoffText("architect", 1, ["status: complete", 'tooling: { node: "22" }']));
    };
    const h = await harness({ scripts: { architect: [withoutModules, architectWriting(techMdText())] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    const rejected = await readFile(join(h.slice.paths.handoffsDir, "architect", "handoff.md.rejected-1"), "utf8");
    expect([h.roleCalls.length, h.roleCalls[1]?.message.includes("missing_required_key:modules"), rejected.includes("role: architect"), h.published.map((event) => [event.type, event.payload["handoffReruns"]])]).toEqual([2, true, true, [["design.tech.ready", 1]]]);
  });

  it("blocks the design after the second unparseable handoff without a third invocation", async () => {
    const silent: RoleScript = async (request) => {
      await writeVia(request, "design/tech.md", techMdText());
    };
    const h = await harness({ scripts: { architect: [silent, silent, silent] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([h.roleCalls.length, h.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])]).toEqual([2, [["design.blocked", "architect_unparseable_handoff", "missing_file"]]]);
  });

  // @covers design-stage:BEH-004
  it("on a repair passes the finding and spec ids to the architect and echoes the spec ids on design.tech.ready", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText())] } });
    const finding = { type: "VD-INFEASIBLE", specIds: ["todo-cli:BEH-002"], detail: "clock not injectable" };

    await runArchitectEffect({ kind: "design.architect", attempt: 2, specIds: ["todo-cli:BEH-002"], finding }, h.context(stateIn("building")), h.slice);

    expect([h.roleCalls[0]?.message.includes("- attempt: 2"), h.roleCalls[0]?.message.includes('"detail":"clock not injectable"'), h.published.map((event) => [event.type, event.payload["specIds"]])]).toEqual([true, true, [["design.tech.ready", ["todo-cli:BEH-002"]]]]);
  });
});
