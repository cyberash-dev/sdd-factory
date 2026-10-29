import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ExecCommandRunner } from "./factory/adapters/outbound/exec-command-runner.js";
import { startRun } from "./factory/application/compose.js";
import { NudgeError, recordNudge } from "./factory/application/nudge.js";
import { fileExists, preflight, PreflightError } from "./factory/application/preflight.js";
import { failureReport, successSummary } from "./factory/application/terminal-report.js";
import { parseArgv, USAGE, UsageError } from "./factory/domain/argv.js";
import { exitCodeOf } from "./factory/domain/run-manifest.js";
import { loadConfig, mergeConfig } from "./shared/config.js";
import { stageSlices } from "./slices.js";

async function toolchainVersions(repoRoot: string): Promise<{ typescript: string; vitest: string; typesNode: string; agentSdd: string }> {
  const manifest: { devDependencies?: Record<string, string> } = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  const dev = manifest.devDependencies ?? {};
  return { typescript: dev["typescript"] ?? "7.0.2", vitest: dev["vitest"] ?? "5.0.5", typesNode: dev["@types/node"] ?? "26.6.6", agentSdd: "2.1.1" };
}

async function readCosts(traceDir: string): Promise<{ totalUsd: number; midRunInterventions: number }> {
  try {
    const costs: { totals?: { costUsd?: number } } = JSON.parse(await readFile(join(traceDir, "costs.json"), "utf8"));
    const interventions = await readFile(join(traceDir, "interventions.md"), "utf8");
    const nudges = interventions.split("\n").filter((line) => line.includes("mid_run_nudge")).length;
    return { totalUsd: costs.totals?.costUsd ?? 0, midRunInterventions: nudges };
  } catch {
    return { totalUsd: 0, midRunInterventions: 0 };
  }
}

async function runCommand(argv: readonly string[]): Promise<number> {
  const command = parseArgv(argv);
  const repoRoot = process.cwd();
  if (command.kind === "nudge") {
    const path = await recordNudge(repoRoot, command.runId, command.note, process.env["FACTORY_OPERATOR"] ?? "operator", new Date());
    process.stdout.write(`nudge recorded: ${path}\n`);
    return 0;
  }
  const checked = await preflight({
    specPath: command.specPath,
    operatorFlag: command.operator,
    env: process.env,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    fileExists,
  });
  const baseConfig = await loadConfig(join(repoRoot, "factory.config.json"));
  const config = command.maxParallelLanes === null ? baseConfig : mergeConfig(baseConfig, { maxParallelLanes: command.maxParallelLanes });
  const running = await startRun({
    repoRoot,
    specPath: resolve(command.specPath),
    slug: checked.slug,
    operator: checked.operator,
    push: command.push,
    outDir: command.outDir === null ? null : resolve(command.outDir),
    config,
    stageSlices: stageSlices(),
    commandRunner: new ExecCommandRunner(),
    versions: await toolchainVersions(repoRoot),
    now: () => new Date(),
    log: (line) => process.stderr.write(`[factory] ${line}\n`),
  });
  process.stderr.write(`[factory] run ${running.runId} started; run dir ${running.paths.runDir}\n`);
  const outcome = await running.terminal;
  await running.shutdown();
  const costs = await readCosts(running.paths.traceDir);
  if (outcome.manifest.status === "published") {
    const durationMs = Date.parse(outcome.manifest.endedAt ?? outcome.manifest.startedAt) - Date.parse(outcome.manifest.startedAt);
    process.stdout.write(successSummary({ manifest: outcome.manifest, tracePath: join(running.paths.traceDir, "trace.md"), totalCostUsd: costs.totalUsd, durationMs, midRunInterventions: costs.midRunInterventions }));
  } else {
    process.stderr.write(failureReport({ stage: outcome.manifest.stage, reason: outcome.manifest.reason ?? "unknown", detail: outcome.manifest.reason ?? "", runDir: running.paths.runDir, evidencePath: outcome.evidencePath }));
  }
  return exitCodeOf(outcome.manifest.status);
}

async function main(): Promise<void> {
  try {
    const code = await runCommand(process.argv.slice(2));
    process.exitCode = code;
  } catch (error) {
    if (error instanceof UsageError || error instanceof NudgeError) {
      process.stderr.write(`${error.message}\n${USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof PreflightError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write(`factory: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
