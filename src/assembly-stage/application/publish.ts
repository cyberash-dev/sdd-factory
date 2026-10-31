import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { EffectHandler, SliceContext } from "../../shared/slice.js";
import { copyTraceTo } from "../../trace/index.js";
import type { PublishedEntry } from "../domain/ledger.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { errorText } from "./evidence.js";
import { gitIn, type GitRunner } from "./git.js";
import { loadLedger, writeFailedReport, writeRunDirReport, type LedgerIdentity } from "./ledger-store.js";

const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set([".git", "node_modules", "dist"]);

export function isPublishable(path: string): boolean {
  return !path.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

async function copyIntegrationTree(productGit: GitRunner, productDir: string, outputDir: string): Promise<void> {
  const tracked = (await productGit.output(["ls-files", "-z"])).split("\0").filter((path) => path !== "" && isPublishable(path));
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const file of tracked) {
    await mkdir(dirname(join(outputDir, file)), { recursive: true });
    await copyFile(join(productDir, file), join(outputDir, file));
  }
}

async function pushIfConfigured(teamGit: GitRunner, slice: SliceContext): Promise<boolean> {
  if (!slice.push) {
    return false;
  }
  const origin = await teamGit.run(["remote", "get-url", "origin"]);
  if (origin.exitCode !== 0) {
    slice.log("publish: no origin remote, skipping push");
    return false;
  }
  const branch = await teamGit.output(["rev-parse", "--abbrev-ref", "HEAD"]);
  const push = await teamGit.run(["push", "origin", branch]);
  if (push.exitCode !== 0) {
    slice.log(`warning: push rejected (${push.stderr.trim()}); run manually: git push origin ${branch}`);
  }
  return push.exitCode === 0;
}

async function publishTree(slice: SliceContext, runner: CommandRunner, identity: LedgerIdentity): Promise<PublishedEntry> {
  const timeoutMs = slice.config.timeouts.verifierMs;
  const productGit = gitIn(runner, slice.paths.productDir, timeoutMs);
  const teamGit = gitIn(runner, slice.paths.repoRoot, timeoutMs);
  const ledger = await loadLedger(identity);
  const head = await productGit.output(["rev-parse", "HEAD"]);
  if (ledger.verified_head !== null && ledger.verified_head !== head) {
    throw new Error(`integration head ${head} differs from the verified head ${ledger.verified_head}`);
  }
  if ((await productGit.output(["status", "--porcelain", "--untracked-files=no"])) !== "") {
    throw new Error("integration working tree has uncommitted changes");
  }
  await copyIntegrationTree(productGit, slice.paths.productDir, slice.paths.outputDir);
  await copyTraceTo(slice.paths.traceDir, join(slice.paths.outputDir, "trace"));
  const outputRelative = relative(slice.paths.repoRoot, slice.paths.outputDir);
  await teamGit.output(["add", "-A", "--", outputRelative]);
  await teamGit.output(["commit", "-m", `factory: ${slice.slug} ${slice.runId}`, "--", outputRelative]);
  const commitSha = await teamGit.output(["rev-parse", "HEAD"]);
  const pushed = await pushIfConfigured(teamGit, slice);
  const published = { commit_sha: commitSha, output_dir: `${outputRelative}/`, pushed };
  await writeRunDirReport(slice.paths.runDir, ledger, { verdict: "published", published });
  return published;
}

export function publishEffect(runner: CommandRunner): EffectHandler {
  return async (_effect, context, slice) => {
    const identity = { runDir: slice.paths.runDir, runId: slice.runId, slug: slice.slug };
    let published: PublishedEntry;
    try {
      published = await publishTree(slice, runner, identity);
    } catch (error) {
      const detail = errorText(error);
      await writeFailedReport(slice.paths, identity, `publish_failed: ${detail}`);
      context.publish({ type: "run.failed", producer: "assembler", payload: { stage: "publish", reason: "publish_failed", detail } });
      return;
    }
    context.publish({ type: "run.published", producer: "assembler", payload: { commitSha: published.commit_sha, outputDir: published.output_dir, pushed: published.pushed } });
  };
}
