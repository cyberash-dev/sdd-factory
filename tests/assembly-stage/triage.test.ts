import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { triageEffect } from "../../src/assembly-stage/application/triage.js";
import { ApiRoleTimeoutError } from "../../src/shared/llm/api-role-runner.js";
import { writeTextAtomic } from "../../src/shared/fs/text.js";
import { collectingContext, commitFiles, fakeCommandRunner, initRepo, runState, scriptedApiRoles, sliceContext, taskState, tempDir } from "./support.js";

function handoff(route: string): string {
  return `---\nrole: triage\nattempt: 1\nstatus: complete\nroute:\n${route}\n---\nmatched line: error TS2304\n`;
}

async function fixture() {
  const root = await tempDir("assembly-triage");
  const productDir = join(root, "product");
  const baseSha = await initRepo(productDir, "integration", { "package.json": "{}\n", "design/tasks.json": "[]\n" });
  const implSha = await commitFiles(productDir, { "src/store/index.ts": "export const x = 1;\n" }, "T-002");
  const evidencePath = join(root, "run/handoffs/assembly/round-1/typecheck.log");
  await writeTextAtomic(evidencePath, "--- stdout ---\nsrc/store/index.ts(1,1): error TS2304: Cannot find name 'y'.\n--- stderr ---\n\n");
  const state = runState({
    status: "building",
    assemblyRounds: 1,
    tasks: { "T-001": taskState({ covers: ["todo:BEH-001"], writes: ["src/cli/**"] }), "T-002": taskState({ covers: ["todo:BEH-002"], writes: ["src/store/**"], baseSha, implSha }) },
  });
  return { root, evidencePath, state };
}

describe("assembly.triage", () => {
  // @covers assembly-stage:BEH-005
  it("publishes the route written by the triage role and invokes it exactly once", async () => {
    const { root, evidencePath, state } = await fixture();
    const apiRoles = scriptedApiRoles(async () => handoff('  task_id: T-002\n  target: implementer\n  reason: "compile error in src/store/index.ts"'));
    const context = collectingContext(state);

    await triageEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath }, context, sliceContext({ root, apiRoles }));

    expect([context.published, apiRoles.requests.length, apiRoles.requests[0]?.role, apiRoles.requests[0]?.model]).toEqual([
      [{ type: "assembly.triaged", producer: "triage", payload: { taskId: "T-002", target: "implementer", reason: "compile error in src/store/index.ts" } }],
      1,
      "triage",
      "claude-haiku-4-5",
    ]);
  });

  // @covers assembly-stage:BEH-005
  it("tells the role the failing step, the output tail, the tasks and the files each task changed", async () => {
    const { root, evidencePath, state } = await fixture();
    const apiRoles = scriptedApiRoles(async () => handoff("  task_id: null\n  target: planner\n  reason: unknown"));

    await triageEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath }, collectingContext(state), sliceContext({ root, apiRoles }));

    const message = apiRoles.requests[0]?.message ?? "";
    expect([
      message.includes("went red at step typecheck"),
      message.includes("error TS2304: Cannot find name 'y'."),
      message.includes("- T-001: covers [todo:BEH-001], writes [src/cli/**], dependsOn []"),
      message.includes("- T-002: src/store/index.ts"),
      message.includes(join(root, "run/handoffs/triage/handoff.md")),
    ]).toEqual([true, true, true, true, true]);
  });

  // @covers assembly-stage:BEH-005
  it("re-runs the role once with the parse error when the route names an unknown task, then fails the run", async () => {
    const { root, evidencePath, state } = await fixture();
    const apiRoles = scriptedApiRoles(async () => handoff("  task_id: T-999\n  target: implementer\n  reason: guessed"));
    const context = collectingContext(state);

    await triageEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath }, context, sliceContext({ root, apiRoles }));

    expect([apiRoles.requests.length, apiRoles.requests[1]?.message.includes("rejected: invalid_enum_value:route.task_id:T-999"), context.published.map((event) => [event.type, event.payload["reason"]]), (await readdir(join(root, "run/handoffs/triage"))).sort()]).toEqual([
      2,
      true,
      [["run.failed", "unparseable_handoff"]],
      ["handoff.md.rejected-1", "handoff.md.rejected-2"],
    ]);
  });

  // @covers factory:BEH-011
  it("re-runs the role with the timeout note when its loop exceeds the budget and publishes the second route", async () => {
    const { root, evidencePath, state } = await fixture();
    let invocation = 0;
    const apiRoles = scriptedApiRoles(async () => {
      invocation += 1;
      if (invocation === 1) {
        throw new ApiRoleTimeoutError("triage exceeded 1200000 ms");
      }
      return handoff('  task_id: T-002\n  target: implementer\n  reason: "compile error in src/store/index.ts"');
    });
    const context = collectingContext(state);

    await triageEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath }, context, sliceContext({ root, apiRoles }));

    expect([apiRoles.requests.length, apiRoles.requests[1]?.message.includes("without a handoff; continue from the files on disk and write the handoff first"), context.published.map((event) => event.type)]).toEqual([2, true, ["assembly.triaged"]]);
  });

  // @covers assembly-stage:BEH-005
  it("treats a missing handoff as malformed", async () => {
    const { root, evidencePath, state } = await fixture();
    const apiRoles = scriptedApiRoles(async () => null);
    const context = collectingContext(state);

    await triageEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath }, context, sliceContext({ root, apiRoles }));

    expect([apiRoles.requests[1]?.message.includes("rejected: missing_file"), context.published.at(-1)?.payload["detail"]]).toEqual([true, "triage: Your previous handoff was rejected: missing_file. Write the frontmatter exactly as specified."]);
  });
});
