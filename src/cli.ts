import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ExecCommandRunner } from "./factory/adapters/outbound/exec-command-runner.js";
import { startRun } from "./factory/application/compose.js";
import { readRunManifest, ResumeError } from "./factory/application/resume.js";
import { NudgeError, recordNudge } from "./factory/application/nudge.js";
import { fileExists, preflight, PreflightError } from "./factory/application/preflight.js";
import { failureReport, successSummary } from "./factory/application/terminal-report.js";
import { parseArgv, type ResumeCommand, USAGE, UsageError } from "./factory/domain/argv.js";
import { exitCodeOf } from "./factory/domain/run-manifest.js";
import { loadConfig, mergeConfig } from "./shared/config.js";
import { createRedactor } from "./shared/redaction.js";
import { stageSlices } from "./slices.js";

const redactLog = createRedactor(process.env);

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

/* Mozaik core's built-in cloud client warns on every agent loop once the key is blanked; the warning carries no information here. */
function silenceCoreCloudWarning(): void {
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].startsWith("mozaik cloud: no API key")) {
      return;
    }
    warn(...args);
  };
}

interface Launch {
  readonly specPath: string;
  readonly operatorFlag: string | null;
  readonly resume: { readonly fromRunId: string; readonly note: string | null; readonly force: boolean } | null;
}

/* factory:BEH-009: a resumed run takes its spec and operator from the run it continues. */
async function resumeLaunch(repoRoot: string, command: ResumeCommand): Promise<Launch> {
  const source = await readRunManifest(repoRoot, command.runId);
  return { specPath: source.specPath, operatorFlag: source.operator, resume: { fromRunId: command.runId, note: command.note, force: command.force } };
}

async function runCommand(argv: readonly string[]): Promise<number> {
  const command = parseArgv(argv);
  const repoRoot = process.cwd();
  if (command.kind === "nudge") {
    const path = await recordNudge(repoRoot, command.runId, command.note, process.env["FACTORY_OPERATOR"] ?? "operator", new Date());
    process.stdout.write(`nudge recorded: ${path}\n`);
    return 0;
  }
  const env: Readonly<Record<string, string | undefined>> = { ...process.env };
  /* trace:EXT-001 keeps one cloud transport per runtime: Mozaik core would otherwise open a cloud session per agent loop. */
  process.env["MOZAIK_API_KEY"] = "";
  silenceCoreCloudWarning();
  const baseConfig = await loadConfig(join(repoRoot, "factory.config.json"));
  const launch = command.kind === "resume" ? await resumeLaunch(repoRoot, command) : { specPath: command.specPath, operatorFlag: command.operator, resume: null };
  const checked = await preflight({
    specPath: launch.specPath,
    operatorFlag: launch.operatorFlag,
    env,
    models: baseConfig.models,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    fileExists,
  });
  const config = command.maxParallelLanes === null ? baseConfig : mergeConfig(baseConfig, { maxParallelLanes: command.maxParallelLanes });
  const running = await startRun({
    repoRoot,
    specPath: resolve(launch.specPath),
    slug: checked.slug,
    operator: checked.operator,
    push: command.push,
    outDir: command.outDir === null ? null : resolve(command.outDir),
    config,
    stageSlices: stageSlices(env),
    commandRunner: new ExecCommandRunner(),
    versions: await toolchainVersions(repoRoot),
    now: () => new Date(),
    log: (line) => process.stderr.write(`[factory] ${redactLog(line)}\n`),
    env,
    ...(launch.resume === null ? {} : { resume: launch.resume }),
  });
  process.stderr.write(`[factory] run ${running.runId} started; run dir ${running.paths.runDir}\n`);
  const onSignal = (signal: NodeJS.Signals): void => {
    if (signal === "SIGINT" || signal === "SIGTERM") {
      process.stderr.write(`[factory] ${signal} received; ending the run\n`);
      running.terminate(signal);
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const outcome = await running.terminal;
  await running.shutdown();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  const costs = await readCosts(running.paths.traceDir);
  if (outcome.manifest.status === "published") {
    const durationMs = Date.parse(outcome.manifest.endedAt ?? outcome.manifest.startedAt) - Date.parse(outcome.manifest.startedAt);
    process.stdout.write(successSummary({ manifest: outcome.manifest, tracePath: join(running.paths.traceDir, "trace.md"), totalCostUsd: costs.totalUsd, durationMs, midRunInterventions: costs.midRunInterventions }));
  } else {
    process.stderr.write(failureReport({ stage: outcome.manifest.stage, reason: outcome.manifest.reason ?? "unknown", detail: outcome.failureDetail ?? "", runDir: running.paths.runDir, evidencePath: outcome.evidencePath }));
  }
  return exitCodeOf(outcome.manifest.status);
}

async function main(): Promise<void> {
  try {
    const code = await runCommand(process.argv.slice(2));
    process.exitCode = code;
  } catch (error) {
    if (error instanceof ResumeError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
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
