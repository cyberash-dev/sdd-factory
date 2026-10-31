import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { parseTasksJson, tasksJsonSyntaxError, tasksJsonTaskData, TasksJsonParseError, type TasksFile } from "../../shared/design-files/tasks-json.js";
import { parseTechMd, type TechDesign } from "../../shared/design-files/tech-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SimpleFixDeps } from "../../shared/fixer/index.js";
import type { SliceContext } from "../../shared/slice.js";
import { anyGlobMatches } from "../domain/glob.js";
import type { RoleUsage } from "../domain/payloads.js";
import { describeViolations, validateTasks, type TasksViolation } from "../domain/tasks-validator.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { createDesignFileFixer, UNWIRED_FIX_DEPS, type DesignFileFixer } from "./design-file-fix.js";
import { designReworkAttempt, effectInteger, pending, publishBlocked, reworkFindingText, reworkFindingWithFile, TASKS_JSON, TECH_MD, VERIFICATION_MD } from "./effect-support.js";
import { taskCoverIds } from "./eligible-ids.js";
import { PLANNER_MESSAGE } from "./messages.js";
import { productPaths } from "./product-paths.js";
import { handoffPathOf, runStageRole } from "./stage-role.js";
import { installTooling } from "./tooling-install.js";

type Verdict = { readonly kind: "valid"; readonly tasks: TasksFile } | { readonly kind: "invalid"; readonly reason: string };

const TASK_ID = /T-\d{3}/g;
const CAP_RULES: readonly string[] = ["graph_too_deep", "task_too_small"];
const PATH_TOKEN = /[\w.*-]+(?:\/[\w.*-]+)+/g;

async function readPreviousTasks(slice: SliceContext, isRecut: boolean): Promise<TasksFile | null> {
  if (!isRecut) {
    return null;
  }
  const text = await readTextOrNull(join(slice.paths.productDir, TASKS_JSON));
  return text === null ? null : parseTasksJson(text);
}

function taskIdsNamedBy(finding: string, previous: TasksFile): readonly string[] {
  const named = new Set(finding.match(TASK_ID) ?? []);
  for (const path of finding.match(PATH_TOKEN) ?? []) {
    for (const task of previous.tasks) {
      if (anyGlobMatches(task.writes, path)) {
        named.add(task.id);
      }
    }
  }
  return [...named];
}

export function changedTaskIds(previous: TasksFile | null, next: TasksFile): readonly string[] {
  if (previous === null) {
    return [];
  }
  const before = new Map(previous.tasks.map((task) => [task.id, JSON.stringify(task)] as const));
  const changed = next.tasks.filter((task) => before.get(task.id) !== JSON.stringify(task)).map((task) => task.id);
  const nextIds = new Set(next.tasks.map((task) => task.id));
  const removed = previous.tasks.filter((task) => !nextIds.has(task.id)).map((task) => task.id);
  return [...changed, ...removed];
}

function unrelatedChanges(previous: TasksFile | null, next: TasksFile, finding: string): readonly string[] {
  if (previous === null) {
    return [];
  }
  const affected = taskIdsNamedBy(finding, previous);
  if (affected.length === 0) {
    return [];
  }
  return changedTaskIds(previous, next).filter((id) => !affected.includes(id));
}

function reworkReason(violations: readonly TasksViolation[], slice: SliceContext): string {
  const reason = describeViolations(violations);
  const { graphDepth, minCoversPerTask } = slice.config.caps;
  return violations.some((violation) => CAP_RULES.includes(violation.rule)) ? `${reason}; caps: graphDepth ${graphDepth}, minCoversPerTask ${minCoversPerTask}` : reason;
}

/* design-stage:DLT-005: tasks.json that is not JSON goes to the simple-fixer first; the file is read again after it. */
async function readTasksText(slice: SliceContext, fixer: DesignFileFixer): Promise<string | null> {
  const path = join(slice.paths.productDir, TASKS_JSON);
  const text = await readTextOrNull(path);
  const syntaxError = text === null ? null : tasksJsonSyntaxError(text);
  if (syntaxError === null) {
    return text;
  }
  await fixer.repair({ owner: "planner", file: TASKS_JSON, failureOutput: syntaxError, blocks: tasksJsonTaskData, parseError: tasksJsonSyntaxError });
  return readTextOrNull(path);
}

async function judgeTasks(slice: SliceContext, eligibleIds: readonly string[], tech: TechDesign, previous: TasksFile | null, finding: string, fixer: DesignFileFixer): Promise<Verdict> {
  const text = await readTasksText(slice, fixer);
  if (text === null) {
    return { kind: "invalid", reason: `schema: ${TASKS_JSON} was not written` };
  }
  let tasks: TasksFile;
  try {
    tasks = parseTasksJson(text);
  } catch (error) {
    if (error instanceof TasksJsonParseError) {
      return { kind: "invalid", reason: `schema: ${error.message}` };
    }
    throw error;
  }
  const violations = validateTasks({
    tasks,
    eligibleIds,
    moduleIds: tech.modules.map((module) => module.id),
    modulePaths: tech.modules.flatMap((module) => [...module.owns, module.entry]),
    existingPaths: await productPaths(slice.paths.productDir),
    graphDepth: slice.config.caps.graphDepth,
    minCoversPerTask: slice.config.caps.minCoversPerTask,
  });
  if (violations.length > 0) {
    return { kind: "invalid", reason: reworkReason(violations, slice) };
  }
  const unrelated = unrelatedChanges(previous, tasks, finding);
  if (unrelated.length > 0) {
    return { kind: "invalid", reason: `unrelated_task_changed: ${unrelated.join(", ")}` };
  }
  return { kind: "valid", tasks };
}

function uncoveredIdsOf(frontmatter: Readonly<Record<string, unknown>>): readonly string[] {
  const value = frontmatter["uncovered_ids"];
  return Array.isArray(value) ? value.map(String) : [];
}

async function readTechDesign(slice: SliceContext): Promise<TechDesign> {
  const text = await readTextOrNull(join(slice.paths.productDir, TECH_MD));
  if (text === null) {
    throw new Error(`${TECH_MD} missing at planning time`);
  }
  return parseTechMd(text);
}

function originTaskIdOf(effect: Effect): string | null {
  const value = effect["originTaskId"];
  return typeof value === "string" ? value : null;
}

/* build-stage:DLT-008: the task whose finding caused the re-cut restarts even when its record is unchanged. */
function withOriginTask(changed: readonly string[], next: TasksFile, originTaskId: string | null): readonly string[] {
  const isOriginKept = originTaskId !== null && next.tasks.some((task) => task.id === originTaskId);
  return isOriginKept && !changed.includes(originTaskId) ? [...changed, originTaskId] : changed;
}

function publishRework(context: EffectContext, reason: string, usage: RoleUsage, reruns: number, originTaskId: string | null): void {
  context.publish(pending("design.rework", { target: "planner", reason, attempt: designReworkAttempt(context.state), originTaskId, usage, handoffReruns: reruns }));
}

/* design-stage:BEH-002/BEH-003: run the planner, validate tasks.json mechanically, install TD-TOOLING once, then announce the tasks. */
export async function runPlanEffect(effect: Effect, context: EffectContext, slice: SliceContext, commands: CommandRunner, fix: SimpleFixDeps = UNWIRED_FIX_DEPS): Promise<void> {
  const attempt = effectInteger(effect, "attempt", 1);
  const finding = reworkFindingText(effect);
  const tech = await readTechDesign(slice);
  const previous = await readPreviousTasks(slice, context.state.status === "building");
  const eligibleIds = await taskCoverIds(commands, slice.paths.productDir, slice.config.timeouts.verifierMs);
  const message = slice.prompts.render(PLANNER_MESSAGE, {
    slug: slice.slug,
    product_dir: slice.paths.productDir,
    tech_md: TECH_MD,
    verification_md: VERIFICATION_MD,
    tasks_json: TASKS_JSON,
    handoff_path: handoffPathOf(slice, "planner"),
    attempt: String(attempt),
    rework_finding: await reworkFindingWithFile(effect),
    graph_depth: String(slice.config.caps.graphDepth),
    min_covers_per_task: String(slice.config.caps.minCoversPerTask),
    eligible_ids: eligibleIds.join(", "),
  });
  const outcome = await runStageRole(slice, { role: "planner", message });
  if (outcome.kind === "blocked") {
    publishBlocked(context, outcome.reason, outcome.detail, outcome.usage, outcome.reruns);
    return;
  }
  const uncovered = uncoveredIdsOf(outcome.handoff.frontmatter);
  if (uncovered.length > 0) {
    publishRework(context, `uncovered_ids: ${uncovered.join(", ")}`, outcome.usage, outcome.reruns, originTaskIdOf(effect));
    return;
  }
  const verdict = await judgeTasks(slice, eligibleIds, tech, previous, finding, createDesignFileFixer(slice, fix, context));
  if (verdict.kind === "invalid") {
    publishRework(context, verdict.reason, outcome.usage, outcome.reruns, originTaskIdOf(effect));
    return;
  }
  if (context.state.status === "planning") {
    const install = await installTooling({ commands, productDir: slice.paths.productDir, tooling: tech.tooling, timeoutMs: slice.config.timeouts.verifierMs, log: slice.log });
    if (!install.ok) {
      context.publish(pending("run.failed", { stage: "design", reason: "tooling_broken", detail: install.detail }));
      return;
    }
  }
  const tasks = verdict.tasks.tasks.map((task) => ({ id: task.id, covers: task.covers, writes: task.writes, dependsOn: task.dependsOn }));
  context.publish(pending("design.tasks.ready", { path: TASKS_JSON, taskCount: tasks.length, tasks, changedTaskIds: withOriginTask(changedTaskIds(previous, verdict.tasks), verdict.tasks, originTaskIdOf(effect)), usage: outcome.usage, handoffReruns: outcome.reruns }));
}
