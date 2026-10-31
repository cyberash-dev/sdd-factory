import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fixerLaneUnit, type LaneParticipant } from "../../../bus/adapters/mozaik/roster.js";
import { simpleFixAttempts } from "../../../bus/domain/run-state.js";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../fs/text.js";
import { costFieldsOf, runCliLane, withLaneParticipant, type CostFields } from "../../llm/cli-lane.js";
import { isTerminatedOutcome, type CliRoleOutcome } from "../../llm/cli-role-runner.js";
import type { SliceContext } from "../../slice.js";
import { changedFilesOutside, isConcurrentPath, type PathScope } from "../domain/fix-scope.js";
import { fixerInstructionVariables, fixerMessage, type FixerPromptInput } from "../domain/fixer-prompt.js";
import { isOwnerOf, TRIGGER_TABLE, type FixOutcome, type FixOwner, type FixTrigger } from "../domain/fix-triggers.js";
import { formatOnlyViolations } from "../domain/format-only.js";
import type { TreeChanges, TreeSnapshot, WorkingTree } from "../ports/outbound/working-tree.js";

export interface FormatOnlyFile {
  readonly path: string;
  readonly parse: (text: string) => ReadonlyMap<string, string>;
}

export interface FixCheck {
  readonly passed: boolean;
  readonly output: string;
}

export interface SimpleFixRequest {
  readonly trigger: FixTrigger;
  readonly owner: FixOwner;
  readonly unit: string;
  readonly taskId: string | null;
  readonly directory: string;
  readonly scope: PathScope;
  readonly formatOnly: readonly FormatOnlyFile[];
  readonly failureOutput: string;
  readonly check: () => Promise<FixCheck>;
}

export interface SimpleFixDeps {
  readonly tree: WorkingTree;
  readonly delay: (ms: number) => Promise<void>;
}

export interface SimpleFixRun {
  readonly attempt: number;
  readonly outcome: FixOutcome;
  readonly filesChanged: readonly string[];
  readonly violations: readonly string[];
  readonly answerPath: string;
  readonly cost: CostFields;
}

export interface SimpleFixResult {
  readonly verdict: "fixed" | "cap_reached" | "terminated";
  readonly runs: readonly SimpleFixRun[];
  readonly lastFailureOutput: string;
}

type ParsedFiles = ReadonlyMap<string, ReadonlyMap<string, string>>;

interface RunVerdict {
  readonly outcome: FixOutcome;
  readonly violations: readonly string[];
  readonly nextOutput: string;
}

async function parsedFiles(directory: string, files: readonly FormatOnlyFile[]): Promise<ParsedFiles> {
  const parsed = new Map<string, ReadonlyMap<string, string>>();
  for (const file of files) {
    const text = await readTextOrNull(join(directory, file.path));
    parsed.set(file.path, text === null ? new Map() : file.parse(text));
  }
  return parsed;
}

async function violationsOf(request: SimpleFixRequest, changes: TreeChanges, before: ParsedFiles): Promise<readonly string[]> {
  const outside = changedFilesOutside(request.scope, changes.files.map((change) => change.path)).map((path) => `${path}: outside the allowed paths`);
  const after = await parsedFiles(request.directory, request.formatOnly);
  const formatOnly = request.formatOnly.flatMap((file) =>
    formatOnlyViolations(before.get(file.path) ?? new Map(), after.get(file.path) ?? new Map()).map((violation) => `${file.path}: ${violation.id} ${violation.kind}`),
  );
  return [...outside, ...formatOnly, ...(changes.headMoved ? ["HEAD moved"] : [])];
}

/* design-stage:DLT-012: a concurrent role's file changed during the run is left out of the verdict and the revert. */
function fixerChanges(scope: PathScope, changes: TreeChanges): TreeChanges {
  return { ...changes, files: changes.files.filter((change) => !isConcurrentPath(scope, change.path)) };
}

async function verdictOf(deps: SimpleFixDeps, request: SimpleFixRequest, snapshot: TreeSnapshot, changes: TreeChanges, before: ParsedFiles, output: string): Promise<RunVerdict> {
  const violations = await violationsOf(request, changes, before);
  if (violations.length > 0) {
    await deps.tree.restore(request.directory, snapshot, changes);
    return { outcome: "discarded", violations, nextOutput: output };
  }
  const check = await request.check();
  return { outcome: check.passed ? "fixed" : "unfixed", violations, nextOutput: check.passed ? output : check.output };
}

function answerText(outcome: CliRoleOutcome): string {
  const text = outcome.result === null ? `no result (exit ${String(outcome.exitCode)}, timed out ${String(outcome.timedOut)})\n${outcome.stderrTail}` : outcome.result.resultText;
  return `${text.trimEnd()}\n`;
}

function isAlreadyExisting(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

interface FixerRunFiles {
  readonly answerPath: string;
  readonly transcriptPath: string;
}

/* answer-run<n> and transcript-run<n> number the fixer runs of the unit; several owners share a unit ("design"),
   so the run claims the first n with no answer by creating its transcript before the subprocess starts. */
async function claimRunFiles(answerDir: string): Promise<FixerRunFiles> {
  await mkdir(answerDir, { recursive: true });
  for (let run = 1; ; run += 1) {
    const files = { answerPath: join(answerDir, `answer-run${run}.md`), transcriptPath: join(answerDir, `transcript-run${run}.jsonl`) };
    if ((await readTextOrNull(files.answerPath)) !== null) {
      continue;
    }
    try {
      await writeFile(files.transcriptPath, "", { encoding: "utf8", flag: "wx" });
      return files;
    } catch (error) {
      if (!isAlreadyExisting(error)) {
        throw error;
      }
    }
  }
}

async function invokeFixer(slice: SliceContext, deps: SimpleFixDeps, lane: LaneParticipant, prompt: FixerPromptInput, transcriptPath: string): Promise<CliRoleOutcome> {
  const instruction = slice.prompts.render(await slice.prompts.load("simple-fixer"), fixerInstructionVariables(prompt));
  return runCliLane(slice, deps, { worktree: prompt.directory, handoffPath: null, instruction, message: fixerMessage(prompt), transcriptPath }, lane);
}

interface RunInput {
  readonly attempt: number;
  readonly failureOutput: string;
}

/* null: the run was ended by the factory's termination signal; it is not an attempt and the worktree stays as the subprocess left it. */
async function fixOnce(slice: SliceContext, deps: SimpleFixDeps, context: EffectContext, request: SimpleFixRequest, input: RunInput): Promise<(SimpleFixRun & { readonly nextOutput: string }) | null> {
  const prompt: FixerPromptInput = { ...request, attempt: input.attempt, cap: slice.config.caps.simpleFixes, formatOnlyPaths: request.formatOnly.map((file) => file.path), failureOutput: input.failureOutput };
  return withLaneParticipant(slice, "simple-fixer", fixerLaneUnit(request.owner, request.unit), async (lane) => {
    const before = await parsedFiles(request.directory, request.formatOnly);
    const snapshot = await deps.tree.snapshot(request.directory);
    const files = await claimRunFiles(join(slice.paths.handoffsDir, request.unit, "simple-fixer"));
    const outcome = await invokeFixer(slice, deps, lane, prompt, files.transcriptPath);
    if (isTerminatedOutcome(outcome)) {
      slice.log(`simple-fixer ${request.owner}:${request.unit} run ${input.attempt}: ended by a termination signal`);
      return null;
    }
    const changes = fixerChanges(request.scope, await deps.tree.changesSince(request.directory, snapshot));
    const verdict = await verdictOf(deps, request, snapshot, changes, before, input.failureOutput);
    await writeFile(files.answerPath, answerText(outcome), { encoding: "utf8", flag: "wx" });
    const answerPath = relative(slice.paths.runDir, files.answerPath);
    const run = { attempt: input.attempt, outcome: verdict.outcome, filesChanged: changes.files.map((change) => change.path), violations: verdict.violations, answerPath, cost: costFieldsOf(outcome) };
    context.publish({
      type: "fix.attempted",
      producer: "simple-fixer",
      payload: { stage: TRIGGER_TABLE[request.trigger].stage, taskId: request.taskId, unit: request.unit, owner: request.owner, trigger: request.trigger, attempt: run.attempt, outcome: run.outcome, filesChanged: run.filesChanged, answerPath, ...run.cost },
    });
    slice.log(`simple-fixer ${request.owner}:${request.unit} run ${run.attempt}: ${run.outcome}${run.violations.length === 0 ? "" : ` (${run.violations.join("; ")})`}`);
    return { ...run, nextOutput: verdict.nextOutput };
  });
}

/* factory:BEH-012 for one failure site: runs the fixer until the check passes or factory:CST-005 is reached; commits are the caller's. */
export async function runSimpleFix(slice: SliceContext, deps: SimpleFixDeps, context: EffectContext, request: SimpleFixRequest): Promise<SimpleFixResult> {
  if (!isOwnerOf(request.trigger, request.owner)) {
    throw new Error(`simple-fixer: ${request.owner} does not own trigger ${request.trigger}`);
  }
  const attemptsBefore = simpleFixAttempts(context.state, request.owner, request.unit);
  const runs: SimpleFixRun[] = [];
  let failureOutput = request.failureOutput;
  while (attemptsBefore + runs.length < slice.config.caps.simpleFixes) {
    const fixRun = await fixOnce(slice, deps, context, request, { attempt: attemptsBefore + runs.length + 1, failureOutput });
    if (fixRun === null) {
      return { verdict: "terminated", runs, lastFailureOutput: failureOutput };
    }
    const { nextOutput, ...run } = fixRun;
    runs.push(run);
    if (run.outcome === "fixed") {
      return { verdict: "fixed", runs, lastFailureOutput: failureOutput };
    }
    failureOutput = nextOutput;
  }
  return { verdict: "cap_reached", runs, lastFailureOutput: failureOutput };
}
