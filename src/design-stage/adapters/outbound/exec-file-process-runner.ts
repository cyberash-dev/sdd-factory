import { execFile } from "node:child_process";
import type { ProcessOptions, ProcessResult, ProcessRunner } from "../../ports/outbound/process-runner.js";

const MAX_BUFFER = 16 * 1024 * 1024;

function isExitError(error: unknown): error is { readonly code: number } {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number";
}

export function createExecFileProcessRunner(): ProcessRunner {
  return {
    run(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, timeout: options.timeoutMs ?? 0, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise({ exitCode: 0, stdout, stderr });
            return;
          }
          if (isExitError(error)) {
            resolvePromise({ exitCode: error.code, stdout, stderr });
            return;
          }
          rejectPromise(new Error(`${command} ${args.join(" ")}: ${error.message}`));
        });
      });
    },
  };
}
