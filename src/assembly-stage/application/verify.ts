import { isAbsolute, join, relative } from "node:path";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { ensureDir, readTextOrNull, writeTextAtomic } from "../../shared/fs/text.js";
import type { EffectHandler, SliceContext } from "../../shared/slice.js";
import { coversMarkersIn } from "../domain/covers-markers.js";
import type { AssemblyLedger, MergeEntry, MergeResult, RoundFailingTest, StepResult, VerificationEntry } from "../domain/ledger.js";
import { integerField, stringArrayField } from "../domain/payload.js";
import { redactSecrets, secretValuesOf } from "../domain/redaction.js";
import { WRITE_SET_CONFLICT } from "../domain/rework-reasons.js";
import { failingCoversOf, parseSddReadyReport } from "../domain/sdd-ready-report.js";
import { INSTALL_ARGV, NETWORK_FAILURE, OFFLINE_INSTALL_ARGV, VERIFICATION_SEQUENCE, VITEST_REPORT_FILE, stepArgv, type AssemblyStep } from "../domain/verification-steps.js";
import { parseVitestReport } from "../domain/vitest-report.js";
import type { Argv, CommandResult, CommandRunner } from "../ports/outbound/command-runner.js";
import { captureCommand, evidenceDirFor } from "./evidence.js";
import { gitIn, type GitRunner } from "./git.js";
import { REPORT_FILE, updateLedger, writeProductReport, type LedgerIdentity } from "./ledger-store.js";

const INTEGRATION_BRANCH = "integration";
const SDD_READY_REPORT_FILE = "sdd_ready.json";

interface VerifyRun {
  readonly slice: SliceContext;
  readonly context: EffectContext;
  readonly runner: CommandRunner;
  readonly git: GitRunner;
  readonly round: number;
  readonly evidenceDir: string;
  readonly secrets: readonly string[];
  readonly identity: LedgerIdentity;
}

interface StepOutcome {
  readonly entry: VerificationEntry;
  readonly failingCovers: readonly string[];
  readonly failingTests: readonly RoundFailingTest[];
  readonly sddReady: AssemblyLedger["sdd_ready"] | null;
}

function execute(run: VerifyRun, argv: Argv): Promise<CommandResult> {
  return run.runner.run({ argv, cwd: run.slice.paths.productDir, timeoutMs: run.slice.config.timeouts.verifierMs });
}

function entryOf(run: VerifyRun, step: AssemblyStep, argv: Argv, result: CommandResult, verdict: StepResult, evidencePath: string): VerificationEntry {
  return { round: run.round, step, argv: [...argv], exit_code: result.exitCode ?? -1, duration_ms: result.durationMs, result: verdict, evidence_path: evidencePath };
}

function plainOutcome(entry: VerificationEntry): StepOutcome {
  return { entry, failingCovers: [], failingTests: [], sddReady: null };
}

async function mergeTask(run: VerifyRun, taskId: string): Promise<MergeEntry> {
  const implSha = run.context.state.tasks[taskId]?.implSha ?? null;
  if (implSha === null) {
    throw new Error(`missing_commit: ${taskId} has no implSha`);
  }
  const exists = await run.git.run(["cat-file", "-e", `${implSha}^{commit}`]);
  if (exists.exitCode !== 0) {
    throw new Error(`missing_commit: ${taskId} ${implSha}`);
  }
  const entry = (result: MergeResult): MergeEntry => ({ round: run.round, task_id: taskId, impl_sha: implSha, result });
  const ancestor = await run.git.run(["merge-base", "--is-ancestor", implSha, "HEAD"]);
  if (ancestor.exitCode === 0) {
    return entry("skipped_ancestor");
  }
  const merge = await run.git.run(["merge", "--no-edit", implSha]);
  await captureCommand(run.evidenceDir, `merge-${taskId}`, merge, run.secrets);
  if (merge.exitCode !== 0) {
    await run.git.run(["merge", "--abort"]);
    return entry("conflict");
  }
  const head = await run.git.output(["rev-parse", "HEAD"]);
  return entry(head === implSha ? "fast_forward" : "merged");
}

async function runInstall(run: VerifyRun): Promise<StepOutcome> {
  let argv: Argv = INSTALL_ARGV;
  let result = await execute(run, argv);
  if (result.exitCode !== 0 && NETWORK_FAILURE.test(result.stdout + result.stderr)) {
    await captureCommand(run.evidenceDir, "install-online", result, run.secrets);
    argv = OFFLINE_INSTALL_ARGV;
    const retry = await execute(run, argv);
    result = { ...retry, durationMs: result.durationMs + retry.durationMs };
  }
  const evidencePath = await captureCommand(run.evidenceDir, "install", result, run.secrets);
  return plainOutcome(entryOf(run, "install", argv, result, result.exitCode === 0 ? "green" : "red", evidencePath));
}

async function runTypecheck(run: VerifyRun): Promise<StepOutcome> {
  const argv = stepArgv("typecheck", run.evidenceDir);
  const result = await execute(run, argv);
  const evidencePath = await captureCommand(run.evidenceDir, "typecheck", result, run.secrets);
  return plainOutcome(entryOf(run, "typecheck", argv, result, result.exitCode === 0 ? "green" : "red", evidencePath));
}

function productRelative(run: VerifyRun, file: string): string {
  return isAbsolute(file) ? relative(run.slice.paths.productDir, file) : file;
}

async function markersOf(run: VerifyRun, files: readonly string[]): Promise<readonly string[]> {
  const perFile = await Promise.all(files.map(async (file) => coversMarkersIn((await readTextOrNull(join(run.slice.paths.productDir, productRelative(run, file)))) ?? "")));
  return [...new Set(perFile.flat())];
}

async function runTest(run: VerifyRun): Promise<StepOutcome> {
  const argv = stepArgv("test", run.evidenceDir);
  const result = await execute(run, argv);
  await captureCommand(run.evidenceDir, "test", result, run.secrets);
  const evidencePath = join(run.evidenceDir, VITEST_REPORT_FILE);
  const summary = parseVitestReport((await readTextOrNull(evidencePath)) ?? "");
  const verdict: StepResult = result.exitCode === 0 && summary !== null && summary.success ? "green" : "red";
  return {
    entry: entryOf(run, "test", argv, result, verdict, evidencePath),
    failingCovers: await markersOf(run, summary?.failingFiles ?? []),
    failingTests: (summary?.failingTests ?? []).map((test) => ({ ...test, file: productRelative(run, test.file), round: run.round })),
    sddReady: null,
  };
}

async function runSddReady(run: VerifyRun): Promise<StepOutcome> {
  const argv = stepArgv("sdd_ready", run.evidenceDir);
  const result = await execute(run, argv);
  await captureCommand(run.evidenceDir, "sdd_ready", result, run.secrets);
  const evidencePath = join(run.evidenceDir, SDD_READY_REPORT_FILE);
  await writeTextAtomic(evidencePath, redactSecrets(result.stdout, run.secrets));
  const summary = parseSddReadyReport(result.stdout);
  const verdict: StepResult = result.exitCode === 0 && summary !== null && summary.ok ? "green" : "red";
  return {
    entry: entryOf(run, "sdd_ready", argv, result, verdict, evidencePath),
    failingCovers: summary === null ? [] : failingCoversOf(summary),
    failingTests: [],
    sddReady: summary === null ? { ok: false, violations: [] } : { ok: summary.ok, violations: summary.violations.map((violation) => ({ kind: violation.kind, id: violation.id ?? "", file: violation.file ?? "" })) },
  };
}

function runStep(run: VerifyRun, step: AssemblyStep): Promise<StepOutcome> {
  switch (step) {
    case "install":
      return runInstall(run);
    case "typecheck":
      return runTypecheck(run);
    case "test":
      return runTest(run);
    case "sdd_ready":
      return runSddReady(run);
  }
}

async function commitReport(run: VerifyRun, ledger: AssemblyLedger): Promise<void> {
  await writeProductReport(run.slice.paths, ledger, { verdict: "published", published: null });
  await run.git.output(["add", "--", REPORT_FILE]);
  await run.git.output(["commit", "-m", `assembly report round ${run.round}`]);
  const head = await run.git.output(["rev-parse", "HEAD"]);
  await updateLedger(run.identity, (current) => ({ ...current, verified_head: head }));
}

export function verifyEffect(runner: CommandRunner): EffectHandler {
  return async (effect, context, slice) => {
    const round = integerField(effect, "round");
    const taskOrder = stringArrayField(effect, "taskOrder");
    const identity = { runDir: slice.paths.runDir, runId: slice.runId, slug: slice.slug };
    const run: VerifyRun = {
      slice,
      context,
      runner,
      git: gitIn(runner, slice.paths.productDir, slice.config.timeouts.verifierMs),
      round,
      evidenceDir: evidenceDirFor(slice.paths.handoffsDir, round),
      secrets: secretValuesOf(process.env),
      identity,
    };
    await ensureDir(run.evidenceDir);
    await updateLedger(identity, (ledger) => ({ ...ledger, rounds: round, task_order: taskOrder }));
    await run.git.output(["checkout", INTEGRATION_BRANCH]);
    for (const taskId of taskOrder) {
      const merge = await mergeTask(run, taskId);
      await updateLedger(identity, (ledger) => ({ ...ledger, merges: [...ledger.merges, merge] }));
      if (merge.result === "conflict") {
        slice.log(`assembly round ${round}: merge of ${taskId} conflicted, routed to the planner`);
        context.publish({ type: "assembly.triaged", producer: "assembler", payload: { taskId, target: "planner", reason: WRITE_SET_CONFLICT } });
        return;
      }
    }
    for (const step of VERIFICATION_SEQUENCE) {
      const outcome = await runStep(run, step);
      const ledger = await updateLedger(identity, (current) => ({
        ...current,
        verification: [...current.verification, outcome.entry],
        failing_tests: [...current.failing_tests, ...outcome.failingTests],
        sdd_ready: outcome.sddReady ?? current.sdd_ready,
      }));
      if (step === "sdd_ready" && outcome.entry.result === "green") {
        await commitReport(run, ledger);
      }
      context.publish({
        type: "assembly.verified",
        producer: "assembler",
        payload: { result: outcome.entry.result, step, evidencePath: outcome.entry.evidence_path, failingCovers: [...outcome.failingCovers] },
      });
      if (outcome.entry.result === "red") {
        return;
      }
    }
  };
}
