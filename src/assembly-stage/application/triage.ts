import { dirname, join } from "node:path";
import { rename } from "node:fs/promises";
import type { TaskState } from "../../bus/domain/run-state.js";
import { describeHandoffError, parseHandoff, type HandoffResult } from "../../bus/domain/handoff.js";
import { ensureDir, readTextOrNull } from "../../shared/fs/text.js";
import { isRoleTimeout, roleTimeoutNote } from "../../shared/llm/api-role-runner.js";
import { listDirTool, readFileTool, writeFileTool, type ToolTrace } from "../../shared/llm/tools.js";
import type { EffectHandler, SliceContext } from "../../shared/slice.js";
import { isReworkTarget, type ReworkTarget } from "../domain/ledger.js";
import { integerField, stringField } from "../domain/payload.js";
import { VITEST_REPORT_FILE } from "../domain/verification-steps.js";
import { parseVitestReport } from "../domain/vitest-report.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { tailOf } from "./evidence.js";
import { gitIn } from "./git.js";
import { writeFailedReport } from "./ledger-store.js";

export const TRIAGE_HANDOFF = join("triage", "handoff.md");
const OUTPUT_TAIL_LINES = 200;
const MAX_OUTPUT_TOKENS = 4096;

const TRIAGE_MESSAGE = `Assembly round {{round}} of product {{slug}} went red at step {{failing_step}} and the deterministic attribution could not route it.

Run directory: {{run_dir}}
Handoff to write (attempt {{attempt}}): {{handoff_path}}
Tasks file, readable with read_file: {{tasks_json}}

## Tasks
{{task_list}}

## Files changed per task on the integration branch
{{changed_files}}

## Failing files
{{failing_files}}

## Output of the red step (tail, secrets redacted)
\`\`\`
{{output_tail}}
\`\`\`
{{parse_error}}`;

type Tasks = Readonly<Record<string, TaskState>>;

type Route = { readonly ok: true; readonly taskId: string | null; readonly target: ReworkTarget; readonly reason: string } | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function routeOf(result: HandoffResult, tasks: Tasks): Route {
  if (!result.ok) {
    return { ok: false, error: describeHandoffError(result.error) };
  }
  const route = result.handoff.frontmatter["route"];
  if (!isRecord(route)) {
    return { ok: false, error: "invalid_enum_value:route" };
  }
  const taskId = route["task_id"];
  const target = route["target"];
  const reason = route["reason"];
  if (!isReworkTarget(target)) {
    return { ok: false, error: "missing_required_key:route.target" };
  }
  if (typeof reason !== "string") {
    return { ok: false, error: "missing_required_key:route.reason" };
  }
  if (taskId !== null && typeof taskId !== "string") {
    return { ok: false, error: "invalid_enum_value:route.task_id" };
  }
  if (taskId !== null && !Object.hasOwn(tasks, taskId)) {
    return { ok: false, error: `invalid_enum_value:route.task_id:${taskId}` };
  }
  if (taskId === null && target !== "planner") {
    return { ok: false, error: "missing_required_key:route.task_id" };
  }
  return { ok: true, taskId, target, reason };
}

async function changedFilesPerTask(runner: CommandRunner, slice: SliceContext, tasks: Tasks): Promise<string> {
  const git = gitIn(runner, slice.paths.productDir, slice.config.timeouts.verifierMs);
  const lines = await Promise.all(
    Object.entries(tasks).map(async ([id, task]) => {
      if (task.baseSha === null || task.implSha === null) {
        return `- ${id}: (no commits yet)`;
      }
      const diff = await git.run(["diff", "--name-only", task.baseSha, task.implSha]);
      return `- ${id}: ${diff.exitCode === 0 ? diff.stdout.trim().split("\n").filter((line) => line !== "").join(", ") : "(unavailable)"}`;
    }),
  );
  return lines.join("\n");
}

function taskList(tasks: Tasks): string {
  return Object.entries(tasks)
    .map(([id, task]) => `- ${id}: covers [${task.covers.join(", ")}], writes [${task.writes.join(", ")}], dependsOn [${task.dependsOn.join(", ")}]`)
    .join("\n");
}

async function failingFilesOf(step: string, evidenceDir: string): Promise<string> {
  if (step !== "test") {
    return "(none)";
  }
  const summary = parseVitestReport((await readTextOrNull(join(evidenceDir, VITEST_REPORT_FILE))) ?? "");
  const files = summary?.failingFiles ?? [];
  return files.length === 0 ? "(none)" : files.map((file) => `- ${file}`).join("\n");
}

async function rejectHandoff(handoffPath: string, attempt: number): Promise<void> {
  if ((await readTextOrNull(handoffPath)) !== null) {
    await rename(handoffPath, `${handoffPath}.rejected-${attempt}`);
  }
}

export function triageEffect(runner: CommandRunner): EffectHandler {
  return async (effect, context, slice) => {
    const round = integerField(effect, "round");
    const step = stringField(effect, "step");
    const evidencePath = stringField(effect, "evidencePath");
    const evidenceDir = dirname(evidencePath);
    const handoffPath = join(slice.paths.handoffsDir, TRIAGE_HANDOFF);
    await ensureDir(dirname(handoffPath));
    const instructionTemplate = await slice.prompts.load("triage");
    const shared = {
      run_dir: slice.paths.runDir,
      slug: slice.slug,
      handoff_path: handoffPath,
      tasks_json: join("design", "tasks.json"),
      round: String(round),
      failing_step: step,
      output_tail: tailOf((await readTextOrNull(join(evidenceDir, `${step}.log`))) ?? "", OUTPUT_TAIL_LINES),
      failing_files: await failingFilesOf(step, evidenceDir),
      task_list: taskList(context.state.tasks),
      changed_files: await changedFilesPerTask(runner, slice, context.state.tasks),
    };
    const trace: ToolTrace = (entry) => slice.log(`triage tool ${entry.tool} ${entry.path ?? entry.argv?.join(" ") ?? ""}`);
    const maxAttempts = 1 + slice.config.caps.handoffRerun;
    let parseError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const variables = { ...shared, attempt: String(attempt), parse_error: parseError };
      let timedOut = false;
      try {
        const usage = await slice.apiRoles.run({
          role: "triage",
          instruction: slice.prompts.render(instructionTemplate, variables),
          message: slice.prompts.render(TRIAGE_MESSAGE, variables),
          model: slice.config.models.triage,
          tools: [readFileTool(slice.paths.productDir, trace), listDirTool(slice.paths.productDir, trace), writeFileTool(slice.paths.runDir, trace)],
          timeoutMs: slice.config.timeouts.apiRoleMs,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          toolTracePath: join(dirname(handoffPath), `tools-run${attempt}.jsonl`),
        });
        slice.log(`triage attempt ${attempt}: ${usage.inferenceCount} inferences, ${usage.inputTokens}/${usage.outputTokens} tokens, cost ${usage.costUsd === null ? "n/a" : String(usage.costUsd)}`);
      } catch (error) {
        if (!isRoleTimeout(error)) {
          throw error;
        }
        /* factory:BEH-011: a handoff written before the budget ran out still counts; otherwise the timeout is a re-run. */
        timedOut = true;
      }
      const route = routeOf(parseHandoff("triage", await readTextOrNull(handoffPath)), context.state.tasks);
      if (route.ok) {
        context.publish({ type: "assembly.triaged", producer: "triage", payload: { taskId: route.taskId, target: route.target, reason: route.reason } });
        return;
      }
      await rejectHandoff(handoffPath, attempt);
      parseError = timedOut ? `triage_timeout: ${roleTimeoutNote(slice.config.timeouts.apiRoleMs).trim()}` : `Your previous handoff was rejected: ${route.error}. Write the frontmatter exactly as specified.`;
      slice.log(`triage attempt ${attempt} ${timedOut ? "timed out" : `rejected: ${route.error}`}`);
    }
    const detail = `triage: ${parseError}`;
    await writeFailedReport(slice.paths, { runDir: slice.paths.runDir, runId: slice.runId, slug: slice.slug }, `unparseable_handoff: ${detail}`);
    context.publish({ type: "run.failed", producer: "assembler", payload: { stage: "assembly", reason: "unparseable_handoff", detail } });
  };
}
