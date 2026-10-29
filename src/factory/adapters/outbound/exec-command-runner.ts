import { execFile } from "node:child_process";
import type { CommandOptions, CommandResult, CommandRunner } from "../../ports/outbound/command-runner.js";

function isExecError(error: unknown): error is { code?: unknown; killed?: unknown } {
  return typeof error === "object" && error !== null && "cmd" in error;
}

export class ExecCommandRunner implements CommandRunner {
  run(command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      execFile(
        command,
        [...args],
        { cwd: options.cwd, env: options.env ?? process.env, timeout: options.timeoutMs ?? 0, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise({ exitCode: 0, stdout, stderr });
            return;
          }
          if (isExecError(error) && typeof error.code === "number") {
            resolvePromise({ exitCode: error.code, stdout, stderr });
            return;
          }
          if (isExecError(error) && error.killed === true) {
            resolvePromise({ exitCode: 124, stdout, stderr: `${stderr}\ntimed out after ${options.timeoutMs ?? 0} ms` });
            return;
          }
          rejectPromise(error);
        },
      );
    });
  }
}
