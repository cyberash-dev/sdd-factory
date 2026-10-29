export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(argv: readonly string[], cwd: string): Promise<CommandResult>;
}
