export type Argv = readonly [string, ...string[]];

export interface CommandInvocation {
  readonly argv: Argv;
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface CommandRunner {
  run(invocation: CommandInvocation): Promise<CommandResult>;
}
