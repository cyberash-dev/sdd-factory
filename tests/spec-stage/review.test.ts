import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Tool } from "@mozaik-ai/core";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { runReview } from "../../src/spec-stage/application/review.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import { analystHandoff, CLI_SPEC, criticHandoff, effectContext, gaReview, MAJOR_ERRORS_FINDING, MINOR_NEGATIVE_FINDING, MINOR_TITLE_FINDING, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type StageWorkspace } from "./harness.js";

const handoffPath = (ws: StageWorkspace): string => join(ws.handoffsDir, "spec-critic", "handoff.md");

const DECIDE_FINDING = "- id: GA-001\n  kind: gap\n  target_ids: [todo-cli:CTR-001]\n  resolution: decide\n  required_change: add error_taxonomy";

const deps = () => ({ commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

function toolNamed(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
}

describe("spec.review effect", () => {
  // @covers spec-stage:BEH-002
  it("publishes spec.reviewed{round 1, rework} when the critic opens a finding that needs a decision", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeText(ws.gaPath, gaReview(1, "rework", DECIDE_FINDING));
        await writeText(handoffPath(ws), criticHandoff(1, "rework", { findings: [{ id: "GA-001", kind: "gap", target_ids: ["todo-cli:CTR-001"], required_change: "add error_taxonomy", resolution: "decide" }] }));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_review", { stageAttempts: { lintCycles: 0, criticRounds: 1, plannerRecuts: 0, architectRepairs: 0, assemblyRounds: 0 } }));

    await runReview({ kind: "spec.review", round: 1 }, context, sliceContext(ws, roles), deps());

    expect([published, roles.requests[0]?.model]).toEqual([[{ type: "spec.reviewed", producer: "spec-critic", payload: { round: 1, decision: "rework", findingsPath: "spec/review/ga-major.md" } }], DEFAULT_CONFIG.models.critic]);
  });

  // @covers spec-stage:BEH-002
  it("publishes spec.reviewed{round 2, accept} when round 2 finds every decision applied", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(ws.gaPath, gaReview(1, "rework", DECIDE_FINDING));
    const roles = scriptedRoles([
      async () => {
        await writeText(ws.gaPath, gaReview(2, "accept", `${DECIDE_FINDING}\n  applied: yes`));
        await writeText(handoffPath(ws), criticHandoff(2, "accept"));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 2 }, context, sliceContext(ws, roles), deps());

    expect([published, roles.requests[0]?.message.includes("Review round 2")]).toEqual([[{ type: "spec.reviewed", producer: "spec-critic", payload: { round: 2, decision: "accept", findingsPath: "spec/review/ga.md" } }], true]);
  });

  // @covers spec-stage:DLT-001
  it("counts a round whose handoff stays unparseable after the re-run as accept instead of blocking the run", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const garbage = async (): Promise<void> => {
      await writeText(handoffPath(ws), "no frontmatter here\n");
    };
    const roles = scriptedRoles([garbage, garbage]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 1 }, context, sliceContext(ws, roles), deps());

    expect([roles.requests.length, published]).toEqual([2, [{ type: "spec.reviewed", producer: "foreman", payload: { round: 1, decision: "accept", findingsPath: "spec/review/ga.md" } }]]);
  });

  // @covers spec-stage:BEH-002
  it("blocks the run when spec/spec.md changed while the critic ran", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeFile(ws.specPath, `${CLI_SPEC}\n<!-- edited by critic -->\n`, "utf8");
        await writeText(ws.gaPath, gaReview(1, "accept", "[]"));
        await writeText(handoffPath(ws), criticHandoff(1, "accept"));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 1 }, context, sliceContext(ws, roles), deps());

    expect([roles.requests.length, published]).toEqual([1, [{ type: "spec.blocked", producer: "spec-critic", payload: { reason: "analyst_blocked", detail: "critic_wrote_spec: spec/spec.md changed during review round 1" } }]]);
  });

  it("refuses critic writes to spec/spec.md through the tools", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const replies: unknown[] = [];
    const roles = scriptedRoles([
      async (request) => {
        const write = toolNamed(request.tools, "write_file");
        replies.push(await write.invoke({ path: "spec/spec.md", content: "x" }), await write.invoke({ path: "spec/review/ga.md", content: gaReview(1, "accept", "[]") }), await write.invoke({ path: handoffPath(ws), content: criticHandoff(1, "accept") }));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 1 }, context, sliceContext(ws, roles), deps());

    expect([replies[0], published[0]?.type]).toEqual(["ERROR: path spec/spec.md is outside what this role is allowed to write", "spec.reviewed"]);
  });

  // @covers spec-stage:INV-002
  it("gives the critic neither the analyst handoff body in its prompt nor read access to it", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(join(ws.handoffsDir, "spec-analyst", "handoff.md"), analystHandoff(1).replace("analyst notes", "SENTINEL-ANALYST-REASONING"));
    const reads: unknown[] = [];
    const roles = scriptedRoles([
      async (request) => {
        const read = toolNamed(request.tools, "read_file");
        reads.push(await read.invoke({ path: join(ws.handoffsDir, "spec-analyst", "handoff.md") }), await read.invoke({ path: "spec/spec.md" }));
        await writeText(ws.gaPath, gaReview(1, "accept", "[]"));
        await writeText(handoffPath(ws), criticHandoff(1, "accept"));
      },
    ]);
    const { context } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 1 }, context, sliceContext(ws, roles), deps());

    const prompt = `${roles.requests[0]?.instruction ?? ""}\n${roles.requests[0]?.message ?? ""}`;
    expect([prompt.includes("SENTINEL"), prompt.includes("{{"), String(reads[0]).startsWith("ERROR: path"), reads[1]]).toEqual([false, false, true, CLI_SPEC]);
  });

  // @covers spec-stage:INV-002
  it("lets round 2 read only its own round-1 ga.md besides the spec files", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(ws.gaPath, gaReview(1, "rework", DECIDE_FINDING));
    const reads: unknown[] = [];
    const roles = scriptedRoles([
      async (request) => {
        const read = toolNamed(request.tools, "read_file");
        reads.push(await read.invoke({ path: "spec/review/ga.md" }), await read.invoke({ path: "src/index.ts" }));
        await writeText(ws.gaPath, gaReview(2, "accept", `${DECIDE_FINDING}\n  applied: yes`));
        await writeText(handoffPath(ws), criticHandoff(2, "accept"));
      },
    ]);
    const { context } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 2 }, context, sliceContext(ws, roles), deps());

    expect([reads[0], reads[1]]).toEqual([gaReview(1, "rework", DECIDE_FINDING), "ERROR: path src/index.ts is outside what this role is allowed to read"]);
  });

  // @covers spec-stage:DLT-014
  it("publishes spec.reviewed{accept} as the foreman and logs the override when the critic answers rework over minor findings only", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeText(ws.gaPath, gaReview(1, "rework", `${MINOR_TITLE_FINDING}\n${MINOR_NEGATIVE_FINDING}`));
        await writeText(handoffPath(ws), criticHandoff(1, "rework"));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_review"));
    const lines: string[] = [];

    await runReview({ kind: "spec.review", round: 1 }, context, { ...sliceContext(ws, roles), log: (line) => lines.push(line) }, deps());

    expect([published, lines.filter((line) => line.includes("overridden"))]).toEqual([
      [{ type: "spec.reviewed", producer: "foreman", payload: { round: 1, decision: "accept", findingsPath: "spec/review/ga.md" } }],
      ["spec-critic round 1: decision overridden to accept: only minor findings (GA-001, GA-003)"],
    ]);
  });

  // @covers spec-stage:DLT-014
  it("points the rework at ga-major.md and logs the minor findings as advisory when major and minor findings are mixed", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeText(ws.gaPath, gaReview(1, "rework", `${MINOR_TITLE_FINDING}\n${MAJOR_ERRORS_FINDING}\n${MINOR_NEGATIVE_FINDING}`));
        await writeText(handoffPath(ws), criticHandoff(1, "rework"));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_review"));
    const lines: string[] = [];

    await runReview({ kind: "spec.review", round: 1 }, context, { ...sliceContext(ws, roles), log: (line) => lines.push(line) }, deps());

    expect([published, lines.filter((line) => line.includes("advisory"))]).toEqual([
      [{ type: "spec.reviewed", producer: "spec-critic", payload: { round: 1, decision: "rework", findingsPath: "spec/review/ga-major.md" } }],
      ["spec-critic round 1: minor findings kept as advisory: GA-001, GA-003"],
    ]);
  });

  // @covers spec-stage:CTR-003
  it("re-runs the critic when ga.md disagrees with the handoff decision and counts the round as accept after the second miss", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeText(ws.gaPath, gaReview(1, "rework", DECIDE_FINDING));
        await writeText(handoffPath(ws), criticHandoff(1, "accept"));
      },
      async () => {
        await writeText(handoffPath(ws), criticHandoff(1, "accept"));
      },
    ]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 1 }, context, sliceContext(ws, roles), deps());

    expect([roles.requests[1]?.message.includes("rejected: spec/review/ga.md says decision rework but the handoff says accept"), (await readdir(join(ws.handoffsDir, "spec-critic"))).sort(), published]).toEqual([
      true,
      ["handoff.md.rejected-1", "handoff.md.rejected-2"],
      [{ type: "spec.reviewed", producer: "foreman", payload: { round: 1, decision: "accept", findingsPath: "spec/review/ga.md" } }],
    ]);
  });

  // @covers spec-stage:CTR-003
  it("treats a missing ga.md as an invalid handoff and counts the round as accept after the re-run", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([() => writeText(handoffPath(ws), criticHandoff(1, "accept")), () => writeText(handoffPath(ws), criticHandoff(1, "accept"))]);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runReview({ kind: "spec.review", round: 1 }, context, sliceContext(ws, roles), deps());

    expect([roles.requests.length, roles.requests[1]?.message.includes("rejected: spec/review/ga.md was not written"), published]).toEqual([2, true, [{ type: "spec.reviewed", producer: "foreman", payload: { round: 1, decision: "accept", findingsPath: "spec/review/ga.md" } }]]);
  });
});
