import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { triageEffect } from "../../src/assembly-stage/application/triage.js";
import { writeTextAtomic } from "../../src/shared/fs/text.js";
import { collectingContext, fakeCommandRunner, initRepo, runState, scriptedApiRoles, sliceContext, taskState, tempDir } from "./support.js";

describe("assembly.triage in a resumed run", () => {
  // @covers assembly-stage:BEH-005
  it("publishes the route from the handoff the role writes when the handoffs directory lies outside the run directory", async () => {
    const root = await tempDir("assembly-triage-resumed");
    await initRepo(join(root, "product"), "integration", { "package.json": "{}\n", "design/tasks.json": "[]\n" });
    const firstRunHandoffs = join(root, "first-run", "handoffs");
    const evidencePath = join(firstRunHandoffs, "assembly", "round-1", "typecheck.log");
    await writeTextAtomic(evidencePath, "--- stdout ---\nsrc/store/index.ts(1,1): error TS2304: Cannot find name 'y'.\n--- stderr ---\n\n");
    const apiRoles = scriptedApiRoles(async () => '---\nrole: triage\nattempt: 1\nstatus: complete\nroute:\n  task_id: T-001\n  target: implementer\n  reason: "compile error in src/store/index.ts"\n---\n');
    const resumed = sliceContext({ root, apiRoles });
    const context = collectingContext(runState({ status: "building", assemblyRounds: 1, tasks: { "T-001": taskState({ covers: ["todo:BEH-001"], writes: ["src/store/**"] }) } }));

    await triageEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.triage", round: 1, step: "typecheck", evidencePath }, context, { ...resumed, paths: { ...resumed.paths, handoffsDir: firstRunHandoffs } });

    expect(context.published).toEqual([{ type: "assembly.triaged", producer: "triage", payload: { taskId: "T-001", target: "implementer", reason: "compile error in src/store/index.ts" } }]);
  });
});
