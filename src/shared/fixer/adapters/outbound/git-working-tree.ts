import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { laneEnvironment } from "../../../llm/cli-role-runner.js";
import type { CommandResult, CommandRunner } from "../../ports/outbound/command-runner.js";
import type { FileChange, FileChangeKind, TreeChanges, TreeSnapshot, WorkingTree } from "../../ports/outbound/working-tree.js";

export class WorkingTreeError extends Error {
  override readonly name = "WorkingTreeError";
}

const KIND_BY_STATUS: Readonly<Record<string, FileChangeKind>> = { A: "added", M: "modified", T: "modified", D: "deleted" };

function parseNameStatus(output: string): readonly FileChange[] {
  const parts = output.split("\0").filter((part) => part.length > 0);
  const changes: FileChange[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const kind = KIND_BY_STATUS[(parts[index] ?? "").charAt(0)];
    if (kind === undefined) {
      throw new WorkingTreeError(`unexpected diff-tree status ${parts[index] ?? ""}`);
    }
    changes.push({ path: parts[index + 1] ?? "", kind });
  }
  return changes;
}

/* Snapshots go through a throwaway index (GIT_INDEX_FILE) so a dirty tree and its staged changes stay as they are. */
export function createGitWorkingTree(commands: CommandRunner): WorkingTree {
  const baseEnv = laneEnvironment(process.env);
  const git = async (cwd: string, args: readonly string[], indexFile: string | null = null): Promise<CommandResult> => {
    const env = indexFile === null ? baseEnv : { ...baseEnv, GIT_INDEX_FILE: indexFile };
    const result = await commands.run("git", args, { cwd, env });
    if (result.exitCode !== 0) {
      throw new WorkingTreeError(`git ${args.join(" ")} exited ${result.exitCode}: ${result.stderr.trim()}`);
    }
    return result;
  };
  const withScratchIndex = async <T>(body: (indexFile: string) => Promise<T>): Promise<T> => {
    const dir = await mkdtemp(join(tmpdir(), "simple-fixer-index-"));
    try {
      return await body(join(dir, "index"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  const headOf = async (directory: string): Promise<string | null> => {
    const result = await commands.run("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: directory, env: baseEnv });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  };
  const treeOf = async (directory: string): Promise<string> => {
    if ((await git(directory, ["rev-parse", "--show-prefix"])).stdout.trim() !== "") {
      throw new WorkingTreeError(`${directory} is not the top level of its repository`);
    }
    return withScratchIndex(async (indexFile) => {
      await git(directory, ["add", "-A", "--", "."], indexFile);
      return (await git(directory, ["write-tree"], indexFile)).stdout.trim();
    });
  };
  const snapshot = async (directory: string): Promise<TreeSnapshot> => ({ head: await headOf(directory), tree: await treeOf(directory) });
  return {
    snapshot,
    async changesSince(directory, before) {
      const after = await snapshot(directory);
      const diff = await git(directory, ["diff-tree", "-r", "--no-renames", "--name-status", "-z", before.tree, after.tree]);
      return { files: parseNameStatus(diff.stdout), headMoved: after.head !== before.head };
    },
    async restore(directory, before, changes) {
      const toCheckout = changes.files.filter((change) => change.kind !== "added").map((change) => change.path);
      if (toCheckout.length > 0) {
        await withScratchIndex(async (indexFile) => {
          await git(directory, ["read-tree", before.tree], indexFile);
          await git(directory, ["checkout-index", "-f", "--", ...toCheckout], indexFile);
        });
      }
      for (const change of changes.files.filter((item) => item.kind === "added")) {
        await rm(join(directory, change.path), { force: true });
      }
      if (changes.headMoved) {
        await git(directory, before.head === null ? ["update-ref", "-d", "HEAD"] : ["reset", "-q", "--soft", before.head]);
      }
    },
  };
}
