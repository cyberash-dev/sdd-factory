import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExecCommandRunner } from "../../src/factory/adapters/outbound/exec-command-runner.js";

const git = new ExecCommandRunner();

async function run(cwd: string, args: readonly string[]): Promise<{ exitCode: number; stdout: string }> {
  const result = await git.run("git", args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } });
  return { exitCode: result.exitCode, stdout: result.stdout.trim() };
}

async function repoWithIntegration(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "git-"));
  await run(root, ["init", "-q", "-b", "integration"]);
  await writeFile(join(root, "a.txt"), "base\n", "utf8");
  await run(root, ["add", "-A"]);
  await run(root, ["commit", "-q", "-m", "base"]);
  return root;
}

describe("git operations through the command runner", () => {
  // @covers factory:EXT-004
  it("creates a task worktree on its own branch from integration", async () => {
    const root = await repoWithIntegration();
    const worktree = join(root, "..", `wt-${Date.now()}`);

    const added = await run(root, ["worktree", "add", "-q", "-b", "task/T-001", worktree, "integration"]);
    const branch = await run(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]);

    expect([added.exitCode, branch.stdout]).toEqual([0, "task/T-001"]);
  });

  it("merges a clean task branch into integration with exit 0", async () => {
    const root = await repoWithIntegration();
    await run(root, ["checkout", "-q", "-b", "task/T-001"]);
    await writeFile(join(root, "b.txt"), "task\n", "utf8");
    await run(root, ["add", "-A"]);
    await run(root, ["commit", "-q", "-m", "task"]);
    await run(root, ["checkout", "-q", "integration"]);

    const merged = await run(root, ["merge", "--no-ff", "-q", "-m", "merge T-001", "task/T-001"]);

    expect(merged.exitCode).toBe(0);
  });

  it("reports a conflicting merge with a non-zero exit and no conflict markers committed", async () => {
    const root = await repoWithIntegration();
    await run(root, ["checkout", "-q", "-b", "task/T-001"]);
    await writeFile(join(root, "a.txt"), "task\n", "utf8");
    await run(root, ["commit", "-q", "-am", "task"]);
    await run(root, ["checkout", "-q", "integration"]);
    await writeFile(join(root, "a.txt"), "other\n", "utf8");
    await run(root, ["commit", "-q", "-am", "other"]);

    const merged = await run(root, ["merge", "--no-ff", "-q", "-m", "merge", "task/T-001"]);
    const head = await run(root, ["log", "-1", "--format=%s"]);

    expect([merged.exitCode === 0, head.stdout]).toEqual([false, "other"]);
  });

  it("pushes to a local bare remote and fails on a missing remote", async () => {
    const root = await repoWithIntegration();
    const bare = await mkdtemp(join(tmpdir(), "bare-"));
    await run(bare, ["init", "-q", "--bare"]);
    await run(root, ["remote", "add", "origin", bare]);

    const pushed = await run(root, ["push", "-q", "origin", "integration"]);
    const missing = await run(root, ["push", "-q", "nowhere", "integration"]);

    expect([pushed.exitCode, missing.exitCode === 0]).toEqual([0, false]);
  });
});
