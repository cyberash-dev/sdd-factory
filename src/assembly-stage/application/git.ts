import type { CommandResult, CommandRunner } from "../ports/outbound/command-runner.js";

export class GitCommandError extends Error {
  override readonly name = "GitCommandError";

  constructor(args: readonly string[], result: CommandResult) {
    super(`git ${args.join(" ")} exited ${String(result.exitCode)}: ${(result.stderr || result.stdout).trim()}`);
  }
}

export interface GitRunner {
  run(args: readonly string[]): Promise<CommandResult>;
  output(args: readonly string[]): Promise<string>;
}

export function gitIn(runner: CommandRunner, cwd: string, timeoutMs: number): GitRunner {
  const run = (args: readonly string[]): Promise<CommandResult> => runner.run({ argv: ["git", ...args], cwd, timeoutMs });
  return {
    run,
    async output(args) {
      const result = await run(args);
      if (result.exitCode !== 0) {
        throw new GitCommandError(args, result);
      }
      return result.stdout.trim();
    },
  };
}
