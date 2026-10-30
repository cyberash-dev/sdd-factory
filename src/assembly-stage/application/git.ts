import type { CommandRunner as FixerCommandRunner } from "../../shared/fixer/index.js";
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

/* The simple-fixer's working tree drives git through its own port, which carries a per-call env (GIT_INDEX_FILE). */
export function fixerCommandsOf(runner: CommandRunner, timeoutMs: number): FixerCommandRunner {
  return {
    async run(command, args, options) {
      const result = await runner.run({ argv: [command, ...args], cwd: options.cwd, timeoutMs: options.timeoutMs ?? timeoutMs, ...(options.env === undefined ? {} : { env: options.env }) });
      return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr };
    },
  };
}
