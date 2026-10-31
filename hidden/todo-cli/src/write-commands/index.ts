import { noTaskError, storageError } from "../errors/index.js";
import type { CommandResult } from "../errors/index.js";
import { createTask, nextTaskId, readTasks, writeTasks } from "../store/index.js";
import type { TaskList } from "../store/index.js";

function persist(path: string, tasks: TaskList, stdout: string): CommandResult {
  const written = writeTasks(path, tasks);
  if (!written.ok) return { ok: false, error: storageError(path) };
  return { ok: true, stdout };
}

export function runAdd(path: string, text: string, now: Date): CommandResult {
  const read = readTasks(path);
  if (!read.ok) return { ok: false, error: storageError(path) };
  const id = nextTaskId(read.tasks);
  return persist(path, [...read.tasks, createTask(id, text, now)], `#${id} ${text}\n`);
}

export function runDone(path: string, id: number): CommandResult {
  const read = readTasks(path);
  if (!read.ok) return { ok: false, error: storageError(path) };
  const target = read.tasks.find((task) => task.id === id);
  if (target === undefined) return { ok: false, error: noTaskError(id) };
  const stdout = `#${id} done\n`;
  if (target.done) return { ok: true, stdout };
  const updated = read.tasks.map((task) => (task.id === id ? { ...task, done: true } : task));
  return persist(path, updated, stdout);
}

export function runRm(path: string, id: number): CommandResult {
  const read = readTasks(path);
  if (!read.ok) return { ok: false, error: storageError(path) };
  if (!read.tasks.some((task) => task.id === id)) return { ok: false, error: noTaskError(id) };
  return persist(path, read.tasks.filter((task) => task.id !== id), `#${id} removed\n`);
}
