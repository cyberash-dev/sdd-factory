import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateLedger } from "../../src/assembly-stage/application/ledger-store.js";
import { publishEffect } from "../../src/assembly-stage/application/publish.js";
import { collectingContext, fakeCommandRunner, git, initRepo, registerTracer, RUN_ID, runState, SLUG, sliceContext, taskState, tempDir, writeFiles } from "./support.js";

interface EarlierRun {
  readonly runId: string;
  readonly resumedFrom: string | null;
  readonly traceMd: string;
  readonly costUsd: number;
}

function manifestText(runId: string, status: "running" | "failed", resumedFrom: string | null): string {
  const manifest = {
    schemaVersion: 1,
    runId,
    slug: SLUG,
    specPath: "/repo/specs/todo-cli.md",
    operator: "cyberash",
    mode: "autonomous",
    status,
    stage: "build",
    startedAt: "2026-10-29T10:00:00.000Z",
    endedAt: status === "failed" ? "2026-10-29T10:30:00.000Z" : null,
    reason: status === "failed" ? "cap_exhausted" : null,
    commitSha: null,
    outputDir: null,
    pushed: null,
    counters: { tasks: 1, tasksApproved: 0, tasksFailed: 1, reworks: 0 },
    resumedFrom,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function writeEarlierRun(root: string, run: EarlierRun): Promise<void> {
  const costs = { schemaVersion: 1, runId: run.runId, pricing: {}, stages: [], tasks: [], participants: [], entries: [], totals: { durationMs: 1800000, costUsd: run.costUsd, inputTokens: 1000, outputTokens: 100, unknownCostEntries: 0 } };
  await writeFiles(join(root, run.runId), {
    "run.json": manifestText(run.runId, "failed", run.resumedFrom),
    "trace/trace.jsonl": `{"seq":1,"type":"run.started","runId":"${run.runId}"}\n`,
    "trace/trace.md": run.traceMd,
    "trace/costs.json": `${JSON.stringify(costs, null, 2)}\n`,
    "trace/interventions.md": "# interventions\n",
  });
}

async function publishRun(root: string, resumedFrom: string | null): Promise<string> {
  const head = await initRepo(join(root, "product"), "integration", { "package.json": "{}\n", "src/cli/index.js": "export const run = () => 0;\n", "assembly/report.md": "---\nverdict: published\n---\n" });
  const teamDir = join(root, "team");
  await initRepo(teamDir, "main", { "README.md": "team repo\n" });
  await writeFiles(join(root, "run"), { "run.json": manifestText(RUN_ID, "running", resumedFrom), "trace/trace.jsonl": "", "trace/trace.md": "# trace\n", "trace/interventions.md": "# interventions\n" });
  registerTracer(sliceContext({ root }));
  await updateLedger({ runDir: join(root, "run"), runId: RUN_ID, slug: SLUG }, (ledger) => ({ ...ledger, rounds: 1, task_order: ["T-001"], verified_head: head }));
  const context = collectingContext(runState({ status: "publishing", assemblyRounds: 1, tasks: { "T-001": taskState({ implSha: head }) } }));
  await publishEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.publish" }, context, sliceContext({ root, push: false }));
  return teamDir;
}

async function resumedChainRoot(): Promise<string> {
  const root = await tempDir("assembly-publish-chain");
  await writeEarlierRun(root, { runId: "todo-cli-20261029-100000", resumedFrom: null, traceMd: "# trace of the first run\n", costUsd: 1.5 });
  await writeEarlierRun(root, { runId: "todo-cli-20261029-110000", resumedFrom: "todo-cli-20261029-100000", traceMd: "# trace of the second run\n", costUsd: 0.75 });
  return root;
}

describe("assembly.publish of a resumed run", () => {
  // @covers assembly-stage:DLT-007
  // @covers assembly-stage:BEH-008
  // @covers assembly-stage:INV-002
  it("commits the trace directory of each earlier run of the chain under trace/chain/<runId>/ and nothing else beside the product", async () => {
    const root = await resumedChainRoot();

    const teamDir = await publishRun(root, "todo-cli-20261029-110000");

    expect((await git(teamDir, "ls-tree", "-r", "--name-only", "HEAD", "--", `hidden/${SLUG}`)).split("\n")).toEqual([
      "hidden/todo-cli/assembly/report.md",
      "hidden/todo-cli/package.json",
      "hidden/todo-cli/src/cli/index.js",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-100000/costs.json",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-100000/interventions.md",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-100000/trace.jsonl",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-100000/trace.md",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-110000/costs.json",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-110000/interventions.md",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-110000/trace.jsonl",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-110000/trace.md",
      "hidden/todo-cli/trace/costs.json",
      "hidden/todo-cli/trace/interventions.md",
      "hidden/todo-cli/trace/trace.jsonl",
      "hidden/todo-cli/trace/trace.md",
    ]);
  });

  // @covers assembly-stage:DLT-007
  it("publishes each earlier run's own trace.md and costs.json", async () => {
    const root = await resumedChainRoot();

    const teamDir = await publishRun(root, "todo-cli-20261029-110000");

    const chainDir = join(teamDir, "hidden", SLUG, "trace", "chain");
    const firstCosts: { totals: { costUsd: number } } = JSON.parse(await readFile(join(chainDir, "todo-cli-20261029-100000", "costs.json"), "utf8"));
    const secondCosts: { totals: { costUsd: number } } = JSON.parse(await readFile(join(chainDir, "todo-cli-20261029-110000", "costs.json"), "utf8"));
    expect([
      await readFile(join(chainDir, "todo-cli-20261029-100000", "trace.md"), "utf8"),
      await readFile(join(chainDir, "todo-cli-20261029-110000", "trace.md"), "utf8"),
      firstCosts.totals.costUsd,
      secondCosts.totals.costUsd,
    ]).toEqual(["# trace of the first run\n", "# trace of the second run\n", 1.5, 0.75]);
  });

  // @covers assembly-stage:DLT-007
  it("links every earlier run from the published trace.md to its published report", async () => {
    const root = await resumedChainRoot();

    const teamDir = await publishRun(root, "todo-cli-20261029-110000");

    const traceDir = join(teamDir, "hidden", SLUG, "trace");
    const links = [...(await readFile(join(traceDir, "trace.md"), "utf8")).matchAll(/\[trace\.md\]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
    const linked = await Promise.all(links.map((link) => readFile(join(traceDir, link), "utf8")));
    expect([links, linked]).toEqual([
      ["chain/todo-cli-20261029-100000/trace.md", "chain/todo-cli-20261029-110000/trace.md"],
      ["# trace of the first run\n", "# trace of the second run\n"],
    ]);
  });

  // @covers assembly-stage:DLT-007
  // @covers assembly-stage:BEH-008
  it("still publishes the run, with the trace files an earlier run without run.json has left", async () => {
    const root = await tempDir("assembly-publish-chain");
    await writeFiles(join(root, "todo-cli-20261029-110000"), { "trace/trace.jsonl": '{"seq":1,"type":"run.started","runId":"todo-cli-20261029-110000"}\n', "trace/trace.md": "# trace of the second run\n" });

    const teamDir = await publishRun(root, "todo-cli-20261029-110000");

    expect((await git(teamDir, "ls-tree", "-r", "--name-only", "HEAD", "--", `hidden/${SLUG}/trace/chain`)).split("\n")).toEqual([
      "hidden/todo-cli/trace/chain/todo-cli-20261029-110000/trace.jsonl",
      "hidden/todo-cli/trace/chain/todo-cli-20261029-110000/trace.md",
    ]);
  });

  // @covers assembly-stage:DLT-007
  // @covers assembly-stage:BEH-008
  it("publishes no chain directory for a run that is not a resume", async () => {
    const root = await tempDir("assembly-publish-chain");

    const teamDir = await publishRun(root, null);

    expect((await git(teamDir, "ls-tree", "-r", "--name-only", "HEAD", "--", `hidden/${SLUG}/trace`)).split("\n")).toEqual([
      "hidden/todo-cli/trace/costs.json",
      "hidden/todo-cli/trace/interventions.md",
      "hidden/todo-cli/trace/trace.jsonl",
      "hidden/todo-cli/trace/trace.md",
    ]);
  });
});
