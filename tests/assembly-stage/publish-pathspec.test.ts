import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateLedger } from "../../src/assembly-stage/application/ledger-store.js";
import { publishEffect } from "../../src/assembly-stage/application/publish.js";
import { collectingContext, fakeCommandRunner, git, initRepo, registerTracer, RUN_ID, runState, SLUG, sliceContext, taskState, tempDir, writeFiles } from "./support.js";

describe("assembly.publish commit scope", () => {
  // @covers assembly-stage:DLT-004
  // @covers assembly-stage:BEH-008
  it("commits only hidden/<slug>/ and leaves a file the operator staged elsewhere staged", async () => {
    const root = await tempDir("assembly-publish-pathspec");
    const head = await initRepo(join(root, "product"), "integration", { "package.json": "{}\n", "src/cli/index.js": "export const run = () => 0;\n", "assembly/report.md": "---\nverdict: published\n---\n" });
    const teamDir = join(root, "team");
    await initRepo(teamDir, "main", { "README.md": "team repo\n" });
    await writeFiles(teamDir, { "notes/operator.md": "work in progress\n" });
    await git(teamDir, "add", "--", "notes/operator.md");
    await writeFiles(join(root, "run", "trace"), { "trace.jsonl": "", "trace.md": "# trace\n", "interventions.md": "# interventions\n" });
    registerTracer(sliceContext({ root }));
    await updateLedger({ runDir: join(root, "run"), runId: RUN_ID, slug: SLUG }, (ledger) => ({ ...ledger, rounds: 1, task_order: ["T-001"], verified_head: head }));
    const context = collectingContext(runState({ status: "publishing", assemblyRounds: 1, tasks: { "T-001": taskState({ implSha: head }) } }));

    await publishEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.publish" }, context, sliceContext({ root, push: false }));

    const committedOutsideOutput = (await git(teamDir, "show", "--name-only", "--format=", "HEAD")).split("\n").filter((path) => !path.startsWith(`hidden/${SLUG}/`));
    expect([committedOutsideOutput, await git(teamDir, "diff", "--cached", "--name-only")]).toEqual([[], "notes/operator.md"]);
  });
});
