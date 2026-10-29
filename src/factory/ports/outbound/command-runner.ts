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

export class CommandFailedError extends Error {
  override readonly name = "CommandFailedError";

  constructor(
    readonly command: string,
    readonly result: CommandResult,
  ) {
    super(`${command} exited ${result.exitCode}: ${result.stderr.trim().split("\n").slice(-3).join(" | ")}`);
  }
}

export async function runOrThrow(runner: CommandRunner, command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  const result = await runner.run(command, args, options);
  if (result.exitCode !== 0) {
    throw new CommandFailedError(`${command} ${args.join(" ")}`, result);
  }
  return result;
}
