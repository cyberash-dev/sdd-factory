import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateLedger } from "../../src/assembly-stage/application/ledger-store.js";
import { publishEffect } from "../../src/assembly-stage/application/publish.js";
import { collectingContext, commitFiles, fakeCommandRunner, git, initRepo, registerTracer, RUN_ID, runState, SLUG, sliceContext, taskState, tempDir, writeFiles } from "../assembly-stage/support.js";

const PRODUCT_FILES = {
  "package.json": '{"name":"todo-cli","private":true,"scripts":{"test":"node --test tests/"}}\n',
  "package-lock.json": '{"name":"todo-cli","lockfileVersion":3,"packages":{"":{"name":"todo-cli"}}}\n',
  "tsconfig.json": "{}\n",
  "spec/spec.md": "# spec\n",
  "design/tasks.json": "[]\n",
  "src/index.js": "export const run = () => 0;\n",
  "tests/run.test.mjs": "import { test } from 'node:test';\ntest('runs', () => {});\n",
  "assembly/report.md": "---\nverdict: published\n---\n",
};

async function publishedTree(options: { readonly stale?: boolean } = {}): Promise<{ readonly hidden: string; readonly teamDir: string; readonly productDir: string }> {
  const root = await tempDir("factory-publish");
  const productDir = join(root, "product");
  const head = await initRepo(productDir, "integration", PRODUCT_FILES);
  await writeFiles(productDir, { "node_modules/x/index.js": "x\n", "dist/out.js": "built\n" });
  const teamDir = join(root, "team");
  await initRepo(teamDir, "main", { "README.md": "team\n" });
  if (options.stale === true) {
    await commitFiles(teamDir, { [`hidden/${SLUG}/stale.txt`]: "old\n" }, "previous publish");
  }
  const bare = join(root, "origin.git");
  await mkdir(bare);
  await git(bare, "init", "-q", "--bare");
  await git(teamDir, "remote", "add", "origin", bare);
  await writeFiles(join(root, "run", "trace"), { "trace.jsonl": "", "trace.md": "# trace\n", "interventions.md": "# interventions\n" });
  registerTracer(sliceContext({ root }));
  await updateLedger({ runDir: join(root, "run"), runId: RUN_ID, slug: SLUG }, (ledger) => ({ ...ledger, rounds: 1, task_order: ["T-001"], verified_head: head }));
  const context = collectingContext(runState({ status: "publishing", assemblyRounds: 1, tasks: { "T-001": taskState({ implSha: head }) } }));
  await publishEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.publish" }, context, sliceContext({ root, push: true, log: [] }));
  return { hidden: join(teamDir, "hidden", SLUG), teamDir, productDir };
}

async function listFiles(dir: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`])));
  return nested.flat().sort();
}

describe("published product tree contract", () => {
  // @covers factory:CTR-004
  it("contains the required files and the trace, without .git, node_modules or dist", async () => {
    const { hidden, teamDir } = await publishedTree();

    const files = await listFiles(hidden);
    const required = ["package.json", "package-lock.json", "tsconfig.json", "spec/spec.md", "design/tasks.json", "trace/trace.md", "trace/interventions.md"];
    expect([required.every((file) => files.includes(file)), files.some((file) => file.startsWith("node_modules/") || file.startsWith("dist/") || file.startsWith(".git/")), await git(teamDir, "log", "-1", "--format=%s")]).toEqual([
      true,
      false,
      `factory: ${SLUG} ${RUN_ID}`,
    ]);
  });

  it("removes files left by a previous publication of the same slug", async () => {
    const { hidden } = await publishedTree({ stale: true });

    expect((await stat(join(hidden, "stale.txt")).catch(() => null)) === null).toBe(true);
  });

  it("copies every tracked file byte-identical to the integration tree", async () => {
    const { hidden, productDir } = await publishedTree();

    const tracked = (await git(productDir, "ls-files")).split("\n").filter((path) => path.length > 0);
    const identical = await Promise.all(tracked.map(async (path) => (await readFile(join(productDir, path), "utf8")) === (await readFile(join(hidden, path), "utf8"))));
    expect([tracked.length > 0, identical.every(Boolean)]).toEqual([true, true]);
  });
});
