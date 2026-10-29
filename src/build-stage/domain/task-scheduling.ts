import type { RunState, TaskState, TaskStatus } from "../../bus/domain/run-state.js";

const IDLE_STATUSES: readonly TaskStatus[] = ["ready", "approved", "failed"];

export function isLaneActive(task: TaskState): boolean {
  return !IDLE_STATUSES.includes(task.status);
}

function dependenciesApproved(state: RunState, task: TaskState): boolean {
  return task.dependsOn.every((id) => state.tasks[id]?.status === "approved");
}

export function startableTasks(state: RunState, maxParallelLanes: number): readonly string[] {
  const active = Object.values(state.tasks).filter(isLaneActive).length;
  const slots = Math.max(0, maxParallelLanes - active);
  return Object.entries(state.tasks)
    .filter(([, task]) => task.status === "ready" && dependenciesApproved(state, task))
    .map(([id]) => id)
    .sort()
    .slice(0, slots);
}

export function allTasksApproved(state: RunState): boolean {
  const tasks = Object.values(state.tasks);
  return tasks.length > 0 && tasks.every((task) => task.status === "approved");
}
