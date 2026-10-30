import { readFile } from "node:fs/promises";
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

  // @covers design-stage:BEH-001
  it("blocks the design with context_firewall_violation when the architect reads design/verification.md", async () => {
    const peek: RoleScript = async (request) => {
      await readVia(request, "./design/verification.md");
    };
    const h = await harness({ scripts: { architect: [architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, peek)] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])).toEqual([["design.blocked", "context_firewall_violation", "architect read design/verification.md"]]);
  });

  it("blocks the design with context_firewall_violation when the architect lists src/", async () => {
    const h = await harness({
      scripts: {
        architect: [
          architectWriting(techMdText(), ARCHITECT_HANDOFF_LINES, async (request) => {
            await request.tools.find((candidate) => candidate.name === "list_dir")?.invoke({ path: "src" });
          }),
        ],
      },
    });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => event.payload["reason"])).toEqual(["context_firewall_violation"]);
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
