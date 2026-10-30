export interface ProcessOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/* A child process run with its own environment; CommandRunner keeps the stage's env-less request shape for its existing callers. */
export interface ProcessRunner {
  run(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult>;
}
