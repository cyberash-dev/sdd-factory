import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createExecFileCommandRunner } from "../../src/build-stage/adapters/outbound/exec-file-command-runner.js";
import { createGitWorkingTree } from "../../src/shared/fixer/adapters/outbound/git-working-tree.js";

const execFileAsync = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFileAsync("git", [...args], { cwd, env: GIT_ENV })).stdout;
}

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

/* A worktree in the state the green phase leaves it: a committed base plus staged, unstaged and untracked edits. */
async function aDirtyRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fixer-tree-"));
  await put(dir, ".gitignore", "node_modules\n");
  await put(dir, "src/a.ts", "export const a = 1;\n");
  await put(dir, "src/b.ts", "export const b = 1;\n");
  await put(dir, "tests/a.test.ts", "frozen\n");
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "base"]);
  await put(dir, "src/a.ts", "export const a = 2;\n");
  await git(dir, ["add", "src/a.ts"]);
  await put(dir, "src/b.ts", "export const b = 2;\n");
  await put(dir, "src/new.ts", "export const n = 1;\n");
  await put(dir, "node_modules/dep/index.js", "ignored\n");
  return dir;
}

async function contents(dir: string, paths: readonly string[]): Promise<readonly (string | null)[]> {
  return Promise.all(paths.map((path) => readFile(join(dir, path), "utf8").catch(() => null)));
}

const TRACKED = ["src/a.ts", "src/b.ts", "src/new.ts", "tests/a.test.ts", "src/added-by-fixer.ts"];

describe("git working tree snapshot", () => {
  // @covers factory:BEH-012
  it("lists the files a run added, modified and deleted in a dirty tree, ignoring git-ignored files", async () => {
    const dir = await aDirtyRepo();
    const tree = createGitWorkingTree(createExecFileCommandRunner());
    const before = await tree.snapshot(dir);
    await put(dir, "src/b.ts", "export const b = 3;\n");
    await rm(join(dir, "tests/a.test.ts"));
    await put(dir, "src/added-by-fixer.ts", "x\n");
    await put(dir, "node_modules/dep/index.js", "changed\n");

    const changes = await tree.changesSince(dir, before);

    expect(changes).toEqual({
      files: [
        { path: "src/added-by-fixer.ts", kind: "added" },
        { path: "src/b.ts", kind: "modified" },
        { path: "tests/a.test.ts", kind: "deleted" },
      ],
      headMoved: false,
    });
  });

  // @covers factory:BEH-012
  it("restores every changed file byte-equal, deletes added files and keeps the staged edits staged", async () => {
    const dir = await aDirtyRepo();
    const tree = createGitWorkingTree(createExecFileCommandRunner());
    const statusBefore = await git(dir, ["status", "--porcelain=v1"]);
    const filesBefore = await contents(dir, TRACKED);
    const before = await tree.snapshot(dir);
    await put(dir, "src/b.ts", "export const b = 3;\n");
    await put(dir, "src/new.ts", "rewritten\n");
    await rm(join(dir, "tests/a.test.ts"));
    await put(dir, "src/added-by-fixer.ts", "x\n");

    await tree.restore(dir, before, await tree.changesSince(dir, before));

    expect([await contents(dir, TRACKED), await git(dir, ["status", "--porcelain=v1"])]).toEqual([filesBefore, statusBefore]);
  });

  it("moves HEAD back when the run committed", async () => {
    const dir = await aDirtyRepo();
    const tree = createGitWorkingTree(createExecFileCommandRunner());
    const headBefore = await git(dir, ["rev-parse", "HEAD"]);
    const before = await tree.snapshot(dir);
    await git(dir, ["commit", "-q", "-m", "fixer commit"]);
    const changes = await tree.changesSince(dir, before);

    await tree.restore(dir, before, changes);

    expect([changes.headMoved, await git(dir, ["rev-parse", "HEAD"])]).toEqual([true, headBefore]);
  });
});
