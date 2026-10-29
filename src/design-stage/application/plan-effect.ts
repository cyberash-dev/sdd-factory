import { join } from "node:path";
import type { Effect } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { parseTasksJson, TasksJsonParseError, type TasksFile } from "../../shared/design-files/tasks-json.js";
import { parseTechMd, type TechDesign } from "../../shared/design-files/tech-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { productRelative } from "../domain/firewall.js";
import { anyGlobMatches } from "../domain/glob.js";
import type { RoleUsage } from "../domain/payloads.js";
import { describeViolations, validateTasks } from "../domain/tasks-validator.js";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { designReworkAttempt, effectInteger, pending, publishBlocked, reworkFindingText, TASKS_JSON, TECH_MD, VERIFICATION_MD } from "./effect-support.js";
import { approvedRecordIds, TASK_COVER_TYPES } from "./eligible-ids.js";
import { PLANNER_MESSAGE } from "./messages.js";
import { productPaths } from "./product-paths.js";
import { forbiddenReadsFor, handoffPathOf, runStageRole } from "./stage-role.js";
import { installTooling } from "./tooling-install.js";

type Verdict = { readonly kind: "valid"; readonly tasks: TasksFile } | { readonly kind: "invalid"; readonly reason: string };

const TASK_ID = /T-\d{3}/g;
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

async function judgeTasks(slice: SliceContext, commands: CommandRunner, tech: TechDesign, previous: TasksFile | null, finding: string): Promise<Verdict> {
  const text = await readTextOrNull(join(slice.paths.productDir, TASKS_JSON));
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
    eligibleIds: await approvedRecordIds(commands, slice.paths.productDir, slice.config.timeouts.verifierMs, TASK_COVER_TYPES),
    moduleIds: tech.modules.map((module) => module.id),
    modulePaths: tech.modules.flatMap((module) => [...module.owns, module.entry]),
    existingPaths: await productPaths(slice.paths.productDir),
  });
  if (violations.length > 0) {
    return { kind: "invalid", reason: describeViolations(violations) };
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

function publishRework(context: EffectContext, reason: string, usage: RoleUsage, reruns: number): void {
  context.publish(pending("design.rework", { target: "planner", reason, attempt: designReworkAttempt(context.state), usage, handoffReruns: reruns }));
}

/* design-stage:BEH-002/BEH-003: run the planner, validate tasks.json mechanically, install TD-TOOLING once, then announce the tasks. */
export async function runPlanEffect(effect: Effect, context: EffectContext, slice: SliceContext, commands: CommandRunner): Promise<void> {
  const attempt = effectInteger(effect, "attempt", 1);
  const finding = reworkFindingText(effect);
  const tech = await readTechDesign(slice);
  const previous = await readPreviousTasks(slice, context.state.status === "building");
  const message = slice.prompts.render(PLANNER_MESSAGE, {
    slug: slice.slug,
    product_dir: slice.paths.productDir,
    tech_md: TECH_MD,
    verification_md: VERIFICATION_MD,
    tasks_json: TASKS_JSON,
    handoff_path: productRelative(slice.paths.productDir, handoffPathOf(slice, "planner")),
    attempt: String(attempt),
    rework_finding: finding,
  });
  const outcome = await runStageRole(slice, { role: "planner", message, forbiddenReads: forbiddenReadsFor(slice, "planner") });
  if (outcome.kind === "blocked") {
    publishBlocked(context, outcome.reason, outcome.detail, outcome.usage, outcome.reruns);
    return;
  }
  const uncovered = uncoveredIdsOf(outcome.handoff.frontmatter);
  if (uncovered.length > 0) {
    publishRework(context, `uncovered_ids: ${uncovered.join(", ")}`, outcome.usage, outcome.reruns);
    return;
  }
  const verdict = await judgeTasks(slice, commands, tech, previous, finding);
  if (verdict.kind === "invalid") {
    publishRework(context, verdict.reason, outcome.usage, outcome.reruns);
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
  context.publish(pending("design.tasks.ready", { path: TASKS_JSON, taskCount: tasks.length, tasks, changedTaskIds: changedTaskIds(previous, verdict.tasks), usage: outcome.usage, handoffReruns: outcome.reruns }));
}
