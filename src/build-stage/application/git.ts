import { laneEnvironment } from "../../shared/llm/cli-role-runner.js";
import { CommandFailedError, type CommandResult, type CommandRunner } from "../ports/outbound/command-runner.js";

export type MergeOutcome = "merged" | "conflict";

export interface Git {
  run(cwd: string, args: readonly string[]): Promise<CommandResult>;
  tryRun(cwd: string, args: readonly string[]): Promise<CommandResult>;
  revParse(cwd: string, ref: string): Promise<string>;
  changedFiles(cwd: string): Promise<readonly string[]>;
  diffNames(cwd: string, from: string, to: string): Promise<readonly string[]>;
  isUnchanged(cwd: string, ref: string, paths: readonly string[]): Promise<boolean>;
  commitAll(cwd: string, message: string): Promise<string | null>;
  commitPaths(cwd: string, paths: readonly string[], message: string): Promise<string | null>;
  resetHard(cwd: string, ref: string): Promise<void>;
  cleanUntracked(cwd: string): Promise<void>;
  restore(cwd: string, ref: string, paths: readonly string[]): Promise<void>;
  worktreeAdd(repo: string, dir: string, branch: string, startPoint: string): Promise<void>;
  worktreeRemove(repo: string, dir: string, branch: string): Promise<void>;
  checkout(cwd: string, ref: string): Promise<void>;
  merge(cwd: string, branch: string, message: string): Promise<MergeOutcome>;
}

const IDENTITY = { GIT_AUTHOR_NAME: "sdd-factory", GIT_AUTHOR_EMAIL: "factory@sdd-factory.local", GIT_COMMITTER_NAME: "sdd-factory", GIT_COMMITTER_EMAIL: "factory@sdd-factory.local" };

function parsePorcelain(output: string): readonly string[] {
  const parts = output.split("\0").filter((part) => part.length > 0);
  const paths: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index] ?? "";
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (status.startsWith("R") || status.startsWith("C")) {
      index += 1;
      paths.push(parts[index] ?? "");
    }
  }
  return [...new Set(paths.filter((path) => path.length > 0))].sort();
}

export function createGit(commands: CommandRunner): Git {
  const env = { ...laneEnvironment(process.env), ...IDENTITY };
  const tryRun = (cwd: string, args: readonly string[]): Promise<CommandResult> => commands.run("git", args, { cwd, env });
  const run = async (cwd: string, args: readonly string[]): Promise<CommandResult> => {
    const result = await tryRun(cwd, args);
    if (result.exitCode !== 0) {
      throw new CommandFailedError(`git ${args.join(" ")}`, result);
    }
    return result;
  };
  const revParse = async (cwd: string, ref: string): Promise<string> => (await run(cwd, ["rev-parse", ref])).stdout.trim();
  const commitStaged = async (cwd: string, addArgs: readonly string[], message: string): Promise<string | null> => {
    await run(cwd, addArgs);
    if ((await tryRun(cwd, ["diff", "--cached", "--quiet"])).exitCode === 0) {
      return null;
    }
    await run(cwd, ["commit", "-q", "-m", message]);
    return revParse(cwd, "HEAD");
  };
  return {
    run,
    tryRun,
    revParse,
    async changedFiles(cwd) {
      return parsePorcelain((await run(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout);
    },
    async diffNames(cwd, from, to) {
      return (await run(cwd, ["diff", "--name-only", from, to])).stdout.split("\n").filter((line) => line.length > 0);
    },
    async isUnchanged(cwd, ref, paths) {
      if (paths.length === 0) {
        return true;
      }
      return (await tryRun(cwd, ["diff", "--quiet", ref, "--", ...paths])).exitCode === 0;
    },
    commitAll: (cwd, message) => commitStaged(cwd, ["add", "-A", "--", ".", ":(exclude)node_modules"], message),
    commitPaths: (cwd, paths, message) => commitStaged(cwd, ["add", "--", ...paths], message),
    async resetHard(cwd, ref) {
      await run(cwd, ["reset", "-q", "--hard", ref]);
    },
    async cleanUntracked(cwd) {
      await run(cwd, ["clean", "-fdq", "-e", "node_modules"]);
    },
    async restore(cwd, ref, paths) {
      if (paths.length > 0) {
        await run(cwd, ["checkout", "-q", ref, "--", ...paths]);
      }
    },
    async worktreeAdd(repo, dir, branch, startPoint) {
      await run(repo, ["worktree", "add", "-q", "-b", branch, dir, startPoint]);
    },
    async worktreeRemove(repo, dir, branch) {
      await tryRun(repo, ["worktree", "remove", "--force", dir]);
      await tryRun(repo, ["branch", "-D", branch]);
    },
    async checkout(cwd, ref) {
      await run(cwd, ["checkout", "-q", ref]);
    },
    async merge(cwd, branch, message) {
      const result = await tryRun(cwd, ["merge", "--no-ff", "-q", "-m", message, branch]);
      if (result.exitCode === 0) {
        return "merged";
      }
      await tryRun(cwd, ["merge", "--abort"]);
      return "conflict";
    },
  };
}
