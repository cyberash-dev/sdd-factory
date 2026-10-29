import type { RunState, TaskState } from "../../bus/domain/run-state.js";
import type { TaskSpec } from "../../shared/design-files/tasks-json.js";
import type { TechModule, TechTooling } from "../../shared/design-files/tech-md.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import type { LaneRecord } from "../domain/lane-messages.js";
import type { ReworkFinding } from "../domain/rules/support.js";
import { modulesOfTask } from "../domain/stubs.js";
import { taskEntryOf } from "./design-cache.js";
import { recordText, type LaneDeps } from "./lane-deps.js";
import { MissingTaskError } from "../domain/rules/support.js";

export interface LaneInputs {
  readonly entry: TaskSpec;
  readonly task: TaskState;
  readonly modules: readonly TechModule[];
  readonly stubPaths: readonly string[];
  readonly specRecords: readonly LaneRecord[];
  readonly verificationBlocks: readonly LaneRecord[];
  readonly tooling: TechTooling;
}

export function taskStateOf(state: RunState, taskId: string): TaskState {
  const task = state.tasks[taskId];
  if (task === undefined) {
    throw new MissingTaskError(taskId);
  }
  return task;
}

export function requireSha(sha: string | null, label: string): string {
  if (sha === null) {
    throw new Error(`${label} is not recorded yet`);
  }
  return sha;
}

export async function laneInputs(slice: SliceContext, deps: LaneDeps, state: RunState, taskId: string): Promise<LaneInputs> {
  const design = await deps.design.load();
  const entry = taskEntryOf(design, taskId);
  const task = taskStateOf(state, taskId);
  const modules = modulesOfTask(design.tech.modules, entry);
  const specRecords: LaneRecord[] = [];
  for (const id of entry.covers) {
    specRecords.push({ id, text: await recordText(deps, slice.paths.productDir, id) });
  }
  const verificationBlocks = design.verification.blocks.filter((block) => entry.covers.includes(block.id)).map((block) => ({ id: block.id, text: block.yamlSource }));
  return { entry, task, modules, stubPaths: modules.map((module) => module.entry), specRecords, verificationBlocks, tooling: design.tech.tooling };
}

export async function reworkFindingText(finding: ReworkFinding | null): Promise<string | null> {
  if (finding === null) {
    return null;
  }
  const content = finding.findingPath === null ? null : await readTextOrNull(finding.findingPath);
  const reference = finding.findingPath === null ? "" : `\nsource: ${finding.findingPath}`;
  return content === null ? `${finding.reason}${reference}` : `${finding.reason}${reference}\n\n${content.trimEnd()}`;
}
