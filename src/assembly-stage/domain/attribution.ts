import { matchesGlob } from "node:path";
import type { TaskState } from "../../bus/domain/run-state.js";

type Tasks = Readonly<Record<string, TaskState>>;

export function tasksCovering(tasks: Tasks, specId: string): readonly string[] {
  return Object.entries(tasks)
    .filter(([, task]) => task.covers.includes(specId))
    .map(([id]) => id)
    .sort();
}

export function tasksWriting(tasks: Tasks, file: string): readonly string[] {
  return Object.entries(tasks)
    .filter(([, task]) => task.writes.some((pattern) => matchesGlob(file, pattern)))
    .map(([id]) => id)
    .sort();
}

export function uniqueSorted(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort();
}
