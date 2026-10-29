import { execFile } from "node:child_process";
import type { CommandRequest, CommandResult, CommandRunner } from "../../ports/outbound/command-runner.js";

const MAX_BUFFER = 16 * 1024 * 1024;

function isExitError(error: unknown): error is { readonly code: number } {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number";
}

export function createExecFileCommandRunner(): CommandRunner {
  return {
    run(request: CommandRequest): Promise<CommandResult> {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile(request.file, [...request.args], { cwd: request.cwd, timeout: request.timeoutMs, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise({ exitCode: 0, stdout, stderr });
            return;
          }
          if (isExitError(error)) {
            resolvePromise({ exitCode: error.code, stdout, stderr });
            return;
          }
          rejectPromise(new Error(`${request.file} ${request.args.join(" ")}: ${error.message}`));
        });
      });
    },
  };
}
