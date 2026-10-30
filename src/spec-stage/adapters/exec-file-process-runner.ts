import { execFile } from "node:child_process";
import type { CommandOptions, CommandResult, CommandRunner } from "../../shared/fixer/ports/outbound/command-runner.js";

const OUTPUT_LIMIT = 16 * 1024 * 1024;

function isExitError(error: unknown): error is { readonly code: number } {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number";
}

/* The simple-fixer's working tree runs git through this runner; the stage's own CommandRunner only runs sdd. */
export function createExecFileProcessRunner(): CommandRunner {
  return {
    run(command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, timeout: options.timeoutMs ?? 0, maxBuffer: OUTPUT_LIMIT }, (error, stdout, stderr) => {
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
