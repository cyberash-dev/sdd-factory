import { execFile } from "node:child_process";
import type { CommandInvocation, CommandResult, CommandRunner } from "../../ports/outbound/command-runner.js";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export function createExecFileCommandRunner(env: NodeJS.ProcessEnv = process.env): CommandRunner {
  return {
    run(invocation: CommandInvocation): Promise<CommandResult> {
      return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const [binary, ...args] = invocation.argv;
        execFile(binary, args, { cwd: invocation.cwd, timeout: invocation.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, killSignal: "SIGKILL", env }, (error, stdout, stderr) => {
          const durationMs = Date.now() - startedAt;
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr, durationMs, timedOut: false });
            return;
          }
          if (typeof error.code === "string") {
            reject(error);
            return;
          }
          resolve({ exitCode: typeof error.code === "number" ? error.code : null, stdout, stderr, durationMs, timedOut: error.killed === true });
        });
      });
    },
  };
}
