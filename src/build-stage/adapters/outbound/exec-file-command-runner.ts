import { execFile } from "node:child_process";
import { EXIT_COMMAND_NOT_FOUND, EXIT_TIMED_OUT, type CommandOptions, type CommandResult, type CommandRunner } from "../../ports/outbound/command-runner.js";

const OUTPUT_LIMIT = 16 * 1024 * 1024;

function isExecError(error: unknown): error is { readonly code?: unknown; readonly killed?: unknown } {
  return typeof error === "object" && error !== null && "cmd" in error;
}

export function createExecFileCommandRunner(): CommandRunner {
  return {
    run(command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, timeout: options.timeoutMs ?? 0, maxBuffer: OUTPUT_LIMIT }, (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise({ exitCode: 0, stdout, stderr });
            return;
          }
          if (!isExecError(error)) {
            rejectPromise(error);
            return;
          }
          if (typeof error.code === "number") {
            resolvePromise({ exitCode: error.code, stdout, stderr });
            return;
          }
          if (error.code === "ENOENT") {
            resolvePromise({ exitCode: EXIT_COMMAND_NOT_FOUND, stdout, stderr: `${stderr}${command}: command not found (ENOENT)\n` });
            return;
          }
          if (error.killed === true) {
            resolvePromise({ exitCode: EXIT_TIMED_OUT, stdout, stderr: `${stderr}\ntimed out after ${options.timeoutMs ?? 0} ms\n` });
            return;
          }
          rejectPromise(error);
        });
      });
    },
  };
}
