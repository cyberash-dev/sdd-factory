import { isAbsolute, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { withSimpleFix } from "../../bus/domain/run-state.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { createGitWorkingTree, fixScopeOf, runSimpleFix, type AssemblyTrigger, type SimpleFixRun, type WorkingTree } from "../../shared/fixer/index.js";
import { ensureDir, readTextOrNull, writeTextAtomic } from "../../shared/fs/text.js";
import type { EffectHandler, SliceContext } from "../../shared/slice.js";
import { coversMarkersIn } from "../domain/covers-markers.js";
import type { AssemblyLedger, FixEntry, MergeEntry, MergeResult, RoundFailingTest, StepResult, VerificationEntry } from "../domain/ledger.js";
import { integerField, stringArrayField } from "../domain/payload.js";
import { redactSecrets, secretValuesOf } from "../domain/redaction.js";
import { missingScriptsReason, WRITE_SET_CONFLICT } from "../domain/rework-reasons.js";
import { parseReadyEnvelope, SddEnvelopeError, type ReadyEnvelope } from "../../shared/sdd/envelope.js";
import { repairSurfaceMembers } from "../../shared/sdd/surface-members.js";
import { refreshBaselineBlock } from "../domain/baseline-block.js";
import { failingCoversOf } from "../domain/sdd-ready-routing.js";
import { parseTokenEnvelope } from "../domain/sdd-token.js";
import { hasBuildStep, missingScripts, npmScriptsEvidence, npmScriptsNamedIn, scriptNamesOf, type NpmScripts } from "../domain/npm-scripts.js";
import { INSTALL_ARGV, NETWORK_FAILURE, OFFLINE_INSTALL_ARGV, VITEST_REPORT_FILE, stepArgv, verificationSequence, type AssemblyStep } from "../domain/verification-steps.js";
import { parseVitestReport } from "../domain/vitest-report.js";
import type { Argv, CommandResult, CommandRunner } from "../ports/outbound/command-runner.js";
import { captureCommand, commandLog, evidenceDirFor } from "./evidence.js";
import { fixerCommandsOf, gitIn, type GitRunner } from "./git.js";
import { REPORT_FILE, updateLedger, writeProductReport, type LedgerIdentity } from "./ledger-store.js";

const INTEGRATION_BRANCH = "integration";
const SDD_READY_REPORT_FILE = "sdd_ready.json";
const NPM_SCRIPTS_REPORT_FILE = "npm_scripts.json";
const SPEC_FILE = join("spec", "spec.md");
const PACKAGE_FILE = "package.json";
const ROLE_WRITTEN_DIRS = ["design", "spec"] as const;
const ROLE_WRITTEN_COMMIT = "assembly: role-written design and spec files";
const MEMBERSHIP_REPAIR_COMMIT = "spec: surface membership repair";
const TOKEN_ARGV: Argv = ["npx", "sdd", "token", "--format=json"];
const FIXER_AUTHOR = "simple-fixer <simple-fixer@sdd-factory.local>";
const FIXER_OWNER = "assembler";
const FIXER_UNIT = "run";

/* context.state is the snapshot taken when the effect started; fixer runs of this effect are not in it yet. */
interface FixerSession {
  readonly tree: WorkingTree;
  runsInEffect: number;
}

interface VerifyRun {
  readonly slice: SliceContext;
  readonly context: EffectContext;
  readonly runner: CommandRunner;
  readonly git: GitRunner;
  readonly round: number;
  readonly evidenceDir: string;
  readonly secrets: readonly string[];
  readonly identity: LedgerIdentity;
  readonly fixer: FixerSession;
}

interface StepOutcome {
  readonly entry: VerificationEntry;
  readonly failingCovers: readonly string[];
  readonly failingTests: readonly RoundFailingTest[];
  readonly sddReady: AssemblyLedger["sdd_ready"] | null;
  readonly fixTrigger: AssemblyTrigger | null;
  readonly failureOutput: string;
}

function execute(run: VerifyRun, argv: Argv): Promise<CommandResult> {
  return run.runner.run({ argv, cwd: run.slice.paths.productDir, timeoutMs: run.slice.config.timeouts.verifierMs });
}

function entryOf(run: VerifyRun, step: AssemblyStep, argv: readonly string[], result: CommandResult, verdict: StepResult, evidencePath: string): VerificationEntry {
  return { round: run.round, step, argv: [...argv], exit_code: result.exitCode ?? -1, duration_ms: result.durationMs, result: verdict, evidence_path: evidencePath };
}

function plainOutcome(run: VerifyRun, entry: VerificationEntry, result: CommandResult, fixTrigger: AssemblyTrigger | null): StepOutcome {
  return { entry, failingCovers: [], failingTests: [], sddReady: null, fixTrigger: entry.result === "red" ? fixTrigger : null, failureOutput: commandLog(result, run.secrets) };
}

/* assembly-stage:DLT-004: an architect repair or planner re-cut after the last lane started leaves design/ or spec/ uncommitted; other paths stay as they are. */
async function commitRoleWrittenFiles(git: GitRunner): Promise<void> {
  const pendingDirs: string[] = [];
  for (const dir of ROLE_WRITTEN_DIRS) {
    if ((await git.output(["status", "--porcelain", "--untracked-files=all", "--", dir])) !== "") {
      pendingDirs.push(dir);
    }
  }
  if (pendingDirs.length === 0) {
    return;
  }
  await git.output(["add", "-A", "--", ...pendingDirs]);
  await git.output(["commit", "-m", ROLE_WRITTEN_COMMIT, "--", ...pendingDirs]);
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
  const isNetworkFailure = result.exitCode !== 0 && NETWORK_FAILURE.test(result.stdout + result.stderr);
  if (isNetworkFailure) {
    await captureCommand(run.evidenceDir, "install-online", result, run.secrets);
    argv = OFFLINE_INSTALL_ARGV;
    const retry = await execute(run, argv);
    result = { ...retry, durationMs: result.durationMs + retry.durationMs };
  }
  const evidencePath = await captureCommand(run.evidenceDir, "install", result, run.secrets);
  return plainOutcome(run, entryOf(run, "install", argv, result, result.exitCode === 0 ? "green" : "red", evidencePath), result, isNetworkFailure ? null : "assembly_install");
}

/* assembly-stage:DLT-005: a red build is a mechanical failure and takes the simple-fixer trigger of a red typecheck. */
async function runCompileStep(run: VerifyRun, step: "typecheck" | "build"): Promise<StepOutcome> {
  const argv = stepArgv(step, run.evidenceDir);
  const result = await execute(run, argv);
  const evidencePath = await captureCommand(run.evidenceDir, step, result, run.secrets);
  return plainOutcome(run, entryOf(run, step, argv, result, result.exitCode === 0 ? "green" : "red", evidencePath), result, "assembly_typecheck");
}

async function npmScriptsOf(run: VerifyRun): Promise<NpmScripts> {
  return {
    defined: scriptNamesOf(await readTextOrNull(join(run.slice.paths.productDir, PACKAGE_FILE))),
    named: npmScriptsNamedIn((await readTextOrNull(run.slice.paths.specSourcePath)) ?? ""),
  };
}

/* assembly-stage:DLT-006: a script the source spec names but package.json lacks is the implementer's to add, so the check never takes a fixer trigger. */
async function runBuild(run: VerifyRun): Promise<StepOutcome> {
  const scripts = await npmScriptsOf(run);
  const missing = missingScripts(scripts);
  if (missing.length === 0 && scripts.defined.includes("build")) {
    return runCompileStep(run, "build");
  }
  const check: CommandResult = { exitCode: missing.length === 0 ? 0 : 1, stdout: missing.length === 0 ? "" : missingScriptsReason(missing), stderr: "", durationMs: 0, timedOut: false };
  await captureCommand(run.evidenceDir, "build", check, run.secrets);
  const evidencePath = join(run.evidenceDir, NPM_SCRIPTS_REPORT_FILE);
  await writeTextAtomic(evidencePath, npmScriptsEvidence(scripts));
  return plainOutcome(run, entryOf(run, "build", [], check, check.exitCode === 0 ? "green" : "red", evidencePath), check, null);
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
  const isLoadFailureOnly = verdict === "red" && summary !== null && summary.loadFailures.length > 0 && summary.failedAssertions === 0;
  return {
    entry: entryOf(run, "test", argv, result, verdict, evidencePath),
    failingCovers: await markersOf(run, summary?.failingFiles ?? []),
    failingTests: (summary?.failingTests ?? []).map((test) => ({ ...test, file: productRelative(run, test.file), round: run.round })),
    sddReady: null,
    fixTrigger: isLoadFailureOnly ? "assembly_load_failure" : null,
    failureOutput: commandLog(result, run.secrets),
  };
}

async function refreshBaseline(run: VerifyRun): Promise<void> {
  const token = await execute(run, TOKEN_ARGV);
  await captureCommand(run.evidenceDir, "sdd_token", token, run.secrets);
  const envelope = parseTokenEnvelope(token.stdout);
  if (token.exitCode !== 0 || !envelope.ok) {
    throw new Error(`baseline_refresh_failed: ${envelope.ok ? `exit ${String(token.exitCode)}` : envelope.reason}`);
  }
  const specPath = join(run.slice.paths.productDir, SPEC_FILE);
  const spec = await readTextOrNull(specPath);
  if (spec === null) {
    throw new Error(`baseline_refresh_failed: ${SPEC_FILE} is missing`);
  }
  const refreshed = refreshBaselineBlock(spec, { token: envelope.token, commitSha: envelope.commitSha });
  if (refreshed === spec) {
    return;
  }
  await writeTextAtomic(specPath, refreshed);
  await run.git.output(["add", "--", SPEC_FILE]);
  await run.git.output(["commit", "-m", "spec: baseline refresh", "--", SPEC_FILE]);
}

/* assembly-stage:DLT-003: a spec approved before spec-stage:DLT-007 (or a resumed run) lacks the members `sdd ready` checks. */
async function repairSurfaceMembership(run: VerifyRun): Promise<void> {
  const specPath = join(run.slice.paths.productDir, SPEC_FILE);
  const spec = await readTextOrNull(specPath);
  const repair = spec === null ? null : repairSurfaceMembers(spec);
  if (repair === null || repair.added.length === 0) {
    return;
  }
  await writeTextAtomic(specPath, repair.text);
  await run.git.output(["add", "--", SPEC_FILE]);
  await run.git.output(["commit", "-m", MEMBERSHIP_REPAIR_COMMIT, "--", SPEC_FILE]);
  run.slice.log(`assembly round ${run.round}: ${repair.surfaceId} members += ${repair.added.join(", ")}`);
}

function readyEnvelopeOf(text: string): ReadyEnvelope | null {
  try {
    return parseReadyEnvelope(text);
  } catch (error) {
    if (error instanceof SddEnvelopeError) {
      return null;
    }
    throw error;
  }
}

async function runSddReady(run: VerifyRun): Promise<StepOutcome> {
  await repairSurfaceMembership(run);
  await refreshBaseline(run);
  const argv = stepArgv("sdd_ready", run.evidenceDir);
  const result = await execute(run, argv);
  await captureCommand(run.evidenceDir, "sdd_ready", result, run.secrets);
  const evidencePath = join(run.evidenceDir, SDD_READY_REPORT_FILE);
  await writeTextAtomic(evidencePath, redactSecrets(result.stdout, run.secrets));
  const summary = readyEnvelopeOf(result.stdout);
  const verdict: StepResult = result.exitCode === 0 && summary !== null && summary.ok ? "green" : "red";
  return {
    entry: entryOf(run, "sdd_ready", argv, result, verdict, evidencePath),
    failingCovers: summary === null ? [] : failingCoversOf(summary),
    failingTests: [],
    sddReady: summary === null ? { ok: false, violations: [] } : { ok: summary.ok, violations: summary.violations.map((violation) => ({ kind: violation.kind, id: violation.id ?? "", file: violation.file ?? "" })) },
    fixTrigger: null,
    failureOutput: commandLog(result, run.secrets),
  };
}

function runStep(run: VerifyRun, step: AssemblyStep): Promise<StepOutcome> {
  switch (step) {
    case "install":
      return runInstall(run);
    case "typecheck":
      return runCompileStep(run, step);
    case "build":
      return runBuild(run);
    case "test":
      return runTest(run);
    case "sdd_ready":
      return runSddReady(run);
  }
}

async function commitReport(run: VerifyRun, ledger: AssemblyLedger): Promise<void> {
  await writeProductReport(run.slice.paths, ledger, { verdict: "published", published: null });
  await run.git.output(["add", "--", REPORT_FILE]);
  await run.git.output(["commit", "-m", `assembly report round ${run.round}`, "--", REPORT_FILE]);
  const head = await run.git.output(["rev-parse", "HEAD"]);
  await updateLedger(run.identity, (current) => ({ ...current, verified_head: head }));
}

async function settleStep(run: VerifyRun, step: AssemblyStep, outcome: StepOutcome): Promise<void> {
  const ledger = await updateLedger(run.identity, (current) => ({
    ...current,
    verification: [...current.verification, outcome.entry],
    failing_tests: [...current.failing_tests, ...outcome.failingTests],
    sdd_ready: outcome.sddReady ?? current.sdd_ready,
  }));
  if (step === "sdd_ready" && outcome.entry.result === "green") {
    await commitReport(run, ledger);
  }
  run.context.publish({
    type: "assembly.verified",
    producer: "assembler",
    payload: { result: outcome.entry.result, step, evidencePath: outcome.entry.evidence_path, failingCovers: [...outcome.failingCovers] },
  });
}

async function commitFix(run: VerifyRun, fixed: SimpleFixRun): Promise<string | null> {
  if (fixed.filesChanged.length === 0) {
    return null;
  }
  const ledger = await updateLedger(run.identity, (current) => current);
  const fixNumber = ledger.fixes.filter((entry) => entry.round === run.round && entry.commit_sha !== null).length + 1;
  await run.git.output(["add", "-A", "--", ...fixed.filesChanged]);
  await run.git.output(["commit", "-m", `fix assembly round ${run.round} ${fixNumber}`, `--author=${FIXER_AUTHOR}`, "--", ...fixed.filesChanged]);
  return run.git.output(["rev-parse", "HEAD"]);
}

function fixerContext(run: VerifyRun): EffectContext {
  let state = run.context.state;
  for (let runs = 0; runs < run.fixer.runsInEffect; runs += 1) {
    state = withSimpleFix(state, FIXER_OWNER, FIXER_UNIT);
  }
  return { state, publish: (pending) => run.context.publish(pending) };
}

/* factory:BEH-012 assembly row: null once the fixer's change is committed, "terminated" after the factory's termination signal, else the step's last red outcome. */
async function repairStep(run: VerifyRun, step: AssemblyStep, outcome: StepOutcome, trigger: AssemblyTrigger): Promise<StepOutcome | "terminated" | null> {
  const directory = run.slice.paths.productDir;
  let latest = outcome;
  const snapshot = await run.fixer.tree.snapshot(directory);
  const result = await runSimpleFix(run.slice, { tree: run.fixer.tree, delay: (ms) => sleep(ms) }, fixerContext(run), {
    trigger,
    owner: FIXER_OWNER,
    unit: FIXER_UNIT,
    taskId: null,
    directory,
    scope: fixScopeOf({ trigger }),
    formatOnly: [],
    failureOutput: outcome.failureOutput,
    check: async () => {
      latest = await runStep(run, step);
      return { passed: latest.fixTrigger === null, output: latest.failureOutput };
    },
  });
  if (result.verdict === "terminated") {
    return "terminated";
  }
  run.fixer.runsInEffect += result.runs.length;
  const fixed = result.runs.find((fixRun) => fixRun.outcome === "fixed");
  const commitSha = fixed === undefined ? null : await commitFix(run, fixed);
  if (fixed === undefined) {
    /* the unfixed runs leave their edits in the tree; triage and the next round start from the merged head */
    await run.fixer.tree.restore(directory, snapshot, await run.fixer.tree.changesSince(directory, snapshot));
  }
  const entries: readonly FixEntry[] = result.runs.map((fixRun) => ({ round: run.round, attempt: fixRun.attempt, trigger, outcome: fixRun.outcome, commit_sha: fixRun === fixed ? commitSha : null, files: [...fixRun.filesChanged] }));
  await updateLedger(run.identity, (current) => ({ ...current, fixes: [...current.fixes, ...entries] }));
  return fixed === undefined ? latest : null;
}

async function runSequence(run: VerifyRun): Promise<"restart" | "terminated" | "done"> {
  for (const step of verificationSequence(hasBuildStep(await npmScriptsOf(run)))) {
    let outcome = await runStep(run, step);
    if (outcome.fixTrigger !== null) {
      const unrepaired = await repairStep(run, step, outcome, outcome.fixTrigger);
      if (unrepaired === null) {
        return "restart";
      }
      if (unrepaired === "terminated") {
        return "terminated";
      }
      outcome = unrepaired;
    }
    await settleStep(run, step, outcome);
    if (outcome.entry.result === "red") {
      return "done";
    }
  }
  return "done";
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
      fixer: { tree: createGitWorkingTree(fixerCommandsOf(runner, slice.config.timeouts.verifierMs)), runsInEffect: 0 },
    };
    await ensureDir(run.evidenceDir);
    await updateLedger(identity, (ledger) => ({ ...ledger, rounds: round, task_order: taskOrder }));
    await run.git.output(["checkout", INTEGRATION_BRANCH]);
    await commitRoleWrittenFiles(run.git);
    for (const taskId of taskOrder) {
      const merge = await mergeTask(run, taskId);
      await updateLedger(identity, (ledger) => ({ ...ledger, merges: [...ledger.merges, merge] }));
      if (merge.result === "conflict") {
        slice.log(`assembly round ${round}: merge of ${taskId} conflicted, routed to the planner`);
        context.publish({ type: "assembly.triaged", producer: "assembler", payload: { taskId, target: "planner", reason: WRITE_SET_CONFLICT } });
        return;
      }
    }
    while ((await runSequence(run)) === "restart") {
      slice.log(`assembly round ${round}: simple-fixer repaired the tree, restarting at install`);
    }
  };
}
