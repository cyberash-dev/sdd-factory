import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishEffect } from "../../src/assembly-stage/application/publish.js";
import { updateLedger } from "../../src/assembly-stage/application/ledger-store.js";
import { collectingContext, commandLine, commitFiles, fakeCommandRunner, git, initRepo, registerTracer, RUN_ID, runState, SLUG, sliceContext, taskState, tempDir, writeFiles, type FakeCommandRunner } from "./support.js";

const PRODUCT_FILES = {
  "package.json": '{"name":"todo-cli","version":"0.0.0","private":true,"scripts":{"test":"node --test tests/"}}\n',
  "package-lock.json": '{"name":"todo-cli","version":"0.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"todo-cli","version":"0.0.0"}}}\n',
  "tsconfig.json": "{}\n",
  "spec/spec.md": "# spec\n",
  "design/tasks.json": "[]\n",
  "src/cli/index.js": "export const run = () => 0;\n",
  "src/deep/nested/dir/leaf.js": "export const leaf = 1;\n",
  "tests/cli/run.test.mjs": "import { test } from 'node:test';\ntest('runs', () => {});\n",
  "assembly/report.md": "---\nverdict: published\n---\n",
};

interface Fixture {
  readonly root: string;
  readonly productDir: string;
  readonly teamDir: string;
  readonly head: string;
}

async function fixture(options: { readonly origin?: "accepting" | "rejecting" | "none"; readonly staleFile?: boolean } = {}): Promise<Fixture> {
  const root = await tempDir("assembly-publish");
  const productDir = join(root, "product");
  const head = await initRepo(productDir, "integration", PRODUCT_FILES);
  await writeFiles(productDir, { "node_modules/left-pad/index.js": "module.exports = 1;\n", "dist/bundle.js": "built\n" });
  const teamDir = join(root, "team");
  await initRepo(teamDir, "main", { "README.md": "team repo\n" });
  if (options.staleFile === true) {
    await commitFiles(teamDir, { [`hidden/${SLUG}/stale.txt`]: "from a previous publish\n", [`hidden/${SLUG}/package.json`]: "old\n" }, "previous publish");
  }
  const origin = options.origin ?? "accepting";
  if (origin !== "none") {
    const bare = join(root, "origin.git");
    await mkdir(bare);
    await git(bare, "init", "-q", "--bare");
    if (origin === "rejecting") {
      await writeFile(join(bare, "hooks", "pre-receive"), "#!/bin/sh\necho rejected by policy >&2\nexit 1\n", "utf8");
      await chmod(join(bare, "hooks", "pre-receive"), 0o755);
    }
    await git(teamDir, "remote", "add", "origin", bare);
  }
  await writeFiles(join(root, "run", "trace"), { "trace.jsonl": "", "trace.md": "# trace\n", "interventions.md": "# interventions\n" });
  registerTracer(sliceContext({ root }));
  await updateLedger({ runDir: join(root, "run"), runId: RUN_ID, slug: SLUG }, (ledger) => ({ ...ledger, rounds: 1, task_order: ["T-001"], verified_head: head }));
  return { root, productDir, teamDir, head };
}

async function publish(fixture: Fixture, options: { readonly push?: boolean; readonly runner?: FakeCommandRunner } = {}) {
  const runner = options.runner ?? fakeCommandRunner(() => undefined);
  const context = collectingContext(runState({ status: "publishing", assemblyRounds: 1, tasks: { "T-001": taskState({ implSha: fixture.head }) } }));
  const log: string[] = [];
  await publishEffect(runner)({ kind: "assembly.publish" }, context, sliceContext({ root: fixture.root, push: options.push ?? true, log }));
  return { context, runner, log };
}

async function listFiles(dir: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`])));
  return nested.flat().sort();
}

describe("assembly.publish", () => {
  // @covers assembly-stage:BEH-008
  // @covers assembly-stage:INV-005
  it("places the integration tree, the report and the trace under hidden/<slug>/, commits it and publishes the commit sha", async () => {
    const f = await fixture();

    const { context } = await publish(f);

    const commitSha = await git(f.teamDir, "rev-parse", "HEAD");
    const hidden = join(f.teamDir, "hidden", SLUG);
    expect([context.published, await git(f.teamDir, "log", "-1", "--format=%s"), await listFiles(hidden)]).toEqual([
      [{ type: "run.published", producer: "assembler", payload: { commitSha, outputDir: `hidden/${SLUG}/`, pushed: true } }],
      `factory: ${SLUG} ${RUN_ID}`,
      [
        "assembly/report.md",
        "design/tasks.json",
        "package-lock.json",
        "package.json",
        "spec/spec.md",
        "src/cli/index.js",
        "src/deep/nested/dir/leaf.js",
        "tests/cli/run.test.mjs",
        "trace/costs.json",
        "trace/interventions.md",
        "trace/trace.jsonl",
        "trace/trace.md",
        "tsconfig.json",
      ],
    ]);
  });

  // @covers assembly-stage:INV-002
  it("copies every tracked file of the verified head byte-identical and nothing else besides trace/", async () => {
    const f = await fixture();

    await publish(f);

    const hidden = join(f.teamDir, "hidden", SLUG);
    const tracked = (await git(f.productDir, "ls-files")).split("\n").sort();
    const copied = (await listFiles(hidden)).filter((path) => !path.startsWith("trace/"));
    const contents = await Promise.all(tracked.map(async (path) => [await readFile(join(f.productDir, path), "utf8"), await readFile(join(hidden, path), "utf8")]));
    expect([copied, contents.every(([original, published]) => original === published), (await stat(join(hidden, ".git")).catch(() => null)) === null]).toEqual([tracked, true, true]);
  });

  // @covers assembly-stage:BEH-008
  it("reports pushed false after a rejected push and attempts the push exactly once", async () => {
    const f = await fixture({ origin: "rejecting" });

    const { context, runner } = await publish(f);

    expect([context.published[0]?.payload["pushed"], runner.calls.filter((call) => commandLine(call).startsWith("git push")).length]).toEqual([false, 1]);
  });

  // @covers assembly-stage:EXT-002
  it("never retries or forces the push when the remote returns a non-zero exit", async () => {
    const f = await fixture();
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("git push") ? { exitCode: 1, stdout: "", stderr: "! [rejected] main -> main (non-fast-forward)", durationMs: 1, timedOut: false } : undefined));

    const { context, log } = await publish(f, { runner });

    expect([context.published[0]?.payload["pushed"], runner.calls.filter((call) => commandLine(call).startsWith("git push")).map(commandLine), log.some((line) => line.includes("git push origin main"))]).toEqual([
      false,
      ["git push origin main"],
      true,
    ]);
  });

  // @covers assembly-stage:BEH-008
  it("skips the push when the run was started with --no-push", async () => {
    const f = await fixture();

    const { context, runner } = await publish(f, { push: false });

    expect([context.published[0]?.payload["pushed"], runner.calls.some((call) => commandLine(call).startsWith("git push"))]).toEqual([false, false]);
  });

  it("skips the push when the team repository has no origin", async () => {
    const f = await fixture({ origin: "none" });

    const { context, runner } = await publish(f);

    expect([context.published[0]?.payload["pushed"], runner.calls.some((call) => commandLine(call).startsWith("git push"))]).toEqual([false, false]);
  });

  // @covers assembly-stage:INV-002
  it("removes the previous content of hidden/<slug>/ before copying", async () => {
    const f = await fixture({ staleFile: true });

    await publish(f);

    const hidden = join(f.teamDir, "hidden", SLUG);
    expect([(await stat(join(hidden, "stale.txt")).catch(() => null)) === null, await readFile(join(hidden, "package.json"), "utf8")]).toEqual([true, PRODUCT_FILES["package.json"]]);
  });

  // @covers assembly-stage:INV-003
  it("refuses to publish an integration head that differs from the verified head", async () => {
    const f = await fixture();
    await commitFiles(f.productDir, { "src/late.js": "export const late = true;\n" }, "edited after verification");

    const { context } = await publish(f);

    expect([context.published.map((event) => [event.type, event.payload["stage"], event.payload["reason"]]), (await stat(join(f.teamDir, "hidden")).catch(() => null)) === null]).toEqual([[["run.failed", "publish", "publish_failed"]], true]);
  });

  // @covers assembly-stage:BEH-008
  it("fails the run with publish_failed when the commit cannot be created", async () => {
    const f = await fixture();
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("git commit") ? { exitCode: 128, stdout: "", stderr: "fatal: unable to write", durationMs: 1, timedOut: false } : undefined));

    const { context } = await publish(f, { runner });

    expect(context.published).toEqual([{ type: "run.failed", producer: "assembler", payload: { stage: "publish", reason: "publish_failed", detail: "git commit -m factory: todo-cli todo-cli-20261029-120000 -- hidden/todo-cli exited 128: fatal: unable to write" } }]);
  });
});
