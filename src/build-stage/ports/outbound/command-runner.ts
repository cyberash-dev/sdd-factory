export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult>;
}

/* Exit codes the exec adapter reserves for process-level failures, mirroring shell conventions. */
export const EXIT_TIMED_OUT = 124;
export const EXIT_COMMAND_NOT_FOUND = 127;

export class CommandFailedError extends Error {
  override readonly name = "CommandFailedError";

  constructor(
    readonly command: string,
    readonly result: CommandResult,
  ) {
    super(`${command} exited ${result.exitCode}: ${result.stderr.trim().split("\n").slice(-3).join(" | ")}`);
  }
}
