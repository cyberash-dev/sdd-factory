import { join } from "node:path";
import { writeTextAtomic } from "../../shared/fs/text.js";
import { laneEnvironment } from "../../shared/llm/cli-role-runner.js";
import { redactSecrets, secretValuesOf } from "../domain/redaction.js";
import type { CommandEvidence } from "../domain/verifier-evidence.js";
import { EXIT_COMMAND_NOT_FOUND, EXIT_TIMED_OUT, type CommandRunner } from "../ports/outbound/command-runner.js";

export interface VerifierCommandRequest {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly outputDir: string;
  readonly label: string;
  readonly timeoutMs: number;
}

export interface VerifierCommandRun {
  readonly evidence: CommandEvidence;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly runnerMissing: boolean;
}

const RUNNER_MISSING = /could not determine executable to run|command not found|npm ERR! 404|npm error 404/i;

export function isRunnerMissing(exitCode: number, stderr: string): boolean {
  return exitCode === EXIT_COMMAND_NOT_FOUND || RUNNER_MISSING.test(stderr);
}

export async function runVerifierCommand(commands: CommandRunner, request: VerifierCommandRequest): Promise<VerifierCommandRun> {
  const [command, ...args] = request.argv;
  if (command === undefined) {
    throw new Error(`verifier command ${request.label} is empty`);
  }
  const startedAt = Date.now();
  const result = await commands.run(command, args, { cwd: request.cwd, env: laneEnvironment(process.env), timeoutMs: request.timeoutMs });
  const durationMs = Date.now() - startedAt;
  const secrets = secretValuesOf(process.env);
  const stdoutPath = join(request.outputDir, `${request.label}.stdout`);
  const stderrPath = join(request.outputDir, `${request.label}.stderr`);
  await writeTextAtomic(stdoutPath, redactSecrets(result.stdout, secrets));
  await writeTextAtomic(stderrPath, redactSecrets(result.stderr, secrets));
  const timedOut = result.exitCode === EXIT_TIMED_OUT;
  return {
    evidence: { argv: request.argv, exitCode: timedOut ? -1 : result.exitCode, durationMs, stdoutPath, stderrPath },
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut,
    runnerMissing: isRunnerMissing(result.exitCode, result.stderr),
  };
}
