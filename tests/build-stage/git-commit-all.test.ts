import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecFileCommandRunner } from "../../src/build-stage/adapters/outbound/exec-file-command-runner.js";
import { createGit } from "../../src/build-stage/application/git.js";

async function repoWithIgnoredModules(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "commit-all-"));
  const git = createGit(createExecFileCommandRunner());
  await git.run(root, ["init", "-q", "-b", "integration"]);
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  await git.commitAll(root, "scaffold");
  await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
  await writeFile(join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n", "utf8");
  await mkdir(join(root, "design"), { recursive: true });
  await writeFile(join(root, "design", "tasks.json"), "{}\n", "utf8");
  return root;
}

describe("git commitAll", () => {
  // @covers build-stage:BEH-001
  it("commits the new files while an installed node_modules stays ignored", async () => {
    const root = await repoWithIgnoredModules();
    const git = createGit(createExecFileCommandRunner());

    await git.commitAll(root, "design ready");

    const committed = (await git.run(root, ["show", "--name-only", "--format=", "HEAD"])).stdout.trim().split("\n").sort();
    expect([committed, (await git.run(root, ["status", "--porcelain"])).stdout]).toEqual([["design/tasks.json"], ""]);
  });
});
