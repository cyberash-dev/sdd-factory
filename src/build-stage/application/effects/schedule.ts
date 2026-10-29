import { access, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EffectContext } from "../../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../../shared/fs/text.js";
import type { SliceContext } from "../../../shared/slice.js";
import { taskBranch } from "../../domain/handoff-paths.js";
import { isPlaceholderModule, modulesOfTask, stubSource } from "../../domain/stubs.js";
import { startableTasks } from "../../domain/task-scheduling.js";
import type { DesignBundle } from "../../ports/outbound/design-source.js";
import { taskEntryOf } from "../design-cache.js";
import { errorText, type LaneDeps } from "../lane-deps.js";
import { INTEGRATION_BRANCH } from "./integrate.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function needsStub(path: string): Promise<boolean> {
  const existing = await readTextOrNull(path);
  return existing === null || isPlaceholderModule(existing);
}

export async function linkNodeModules(productDir: string, worktree: string): Promise<void> {
  const target = join(worktree, "node_modules");
  await rm(target, { force: true });
  await symlink(join(productDir, "node_modules"), target, "dir");
}

/* `owns` are write-set globs; the only file path a module declares is its entry. */
async function writeStubs(design: DesignBundle, worktree: string, taskId: string): Promise<void> {
  const entry = taskEntryOf(design, taskId);
  for (const module of modulesOfTask(design.tech.modules, entry)) {
    const absolute = join(worktree, module.entry);
    if (await needsStub(absolute)) {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, stubSource(module), "utf8");
    }
  }
}

async function provisionWorktree(slice: SliceContext, deps: LaneDeps, design: DesignBundle, taskId: string): Promise<{ readonly worktree: string; readonly baseSha: string }> {
  const worktree = join(slice.paths.worktreesDir, taskId);
  const branch = taskBranch(taskId);
  if (await exists(worktree)) {
    await deps.git.worktreeRemove(slice.paths.productDir, worktree, branch);
    await rm(worktree, { recursive: true, force: true });
  }
  await mkdir(slice.paths.worktreesDir, { recursive: true });
  await deps.git.worktreeAdd(slice.paths.productDir, worktree, branch, INTEGRATION_BRANCH);
  await linkNodeModules(slice.paths.productDir, worktree);
  await writeStubs(design, worktree, taskId);
  const baseSha = (await deps.git.commitAll(worktree, `scaffold ${taskId}`)) ?? (await deps.git.revParse(worktree, "HEAD"));
  return { worktree, baseSha };
}

/* build-stage:BEH-001 / factory:BEH-004: one worktree per task from the integration head, stubs, then task.ready. */
export async function startLane(slice: SliceContext, deps: LaneDeps, context: EffectContext, design: DesignBundle, taskId: string): Promise<void> {
  const entry = taskEntryOf(design, taskId);
  const token = deps.lanes.tokenOf(taskId);
  try {
    const { worktree, baseSha } = await provisionWorktree(slice, deps, design, taskId);
    if (!deps.lanes.isLive(token)) {
      slice.log(`lane start dropped for ${taskId}: lanes terminated`);
      return;
    }
    context.publish({ type: "task.ready", producer: "foreman", payload: { taskId, worktree, baseSha, covers: entry.covers, writes: entry.writes } });
  } catch (error) {
    context.publish({ type: "task.failed", producer: "foreman", payload: { taskId, reason: "blocked", detail: `worktree_error: ${errorText(error)}` } });
  }
}

export const DESIGN_ARTEFACTS_COMMIT = "spec and design artefacts";

/* Worktrees branch from the integration head, so spec/ and design/ must be committed there first. */
export async function scheduleLanes(slice: SliceContext, deps: LaneDeps, context: EffectContext): Promise<void> {
  const startable = startableTasks(context.state, slice.config.maxParallelLanes);
  if (startable.length === 0) {
    return;
  }
  const design = await deps.design.reload();
  await deps.git.checkout(slice.paths.productDir, INTEGRATION_BRANCH);
  await deps.git.commitAll(slice.paths.productDir, DESIGN_ARTEFACTS_COMMIT);
  for (const taskId of startable) {
    await startLane(slice, deps, context, design, taskId);
  }
}
