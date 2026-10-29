import { execFile } from "node:child_process";
import { laneEnvironment } from "../../shared/llm/cli-role-runner.js";
import type { CommandResult, CommandRunner } from "../ports/command-runner.js";

const OUTPUT_LIMIT = 8 * 1024 * 1024;

export function createExecFileCommandRunner(): CommandRunner {
  return {
    run(argv, cwd): Promise<CommandResult> {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile("npx", ["sdd", ...argv], { cwd, env: laneEnvironment(process.env), maxBuffer: OUTPUT_LIMIT }, (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise({ exitCode: 0, stdout, stderr });
            return;
          }
          if (typeof error.code !== "number") {
            rejectPromise(error);
            return;
          }
          resolvePromise({ exitCode: error.code, stdout, stderr });
        });
      });
    },
  };
}
