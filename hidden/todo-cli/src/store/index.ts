import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Task {
  readonly id: number;
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: string;
}

export type TaskList = readonly Task[];

export type StoreReadResult =
  | { readonly ok: true; readonly tasks: TaskList }
  | { readonly ok: false; readonly path: string };

export type StoreWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly path: string };

export function resolveStoragePath(env: NodeJS.ProcessEnv, cwd: string): string {
  const configured = env.TODO_FILE;
  if (configured !== undefined && configured !== "") return resolve(cwd, configured);
  return join(cwd, "todo.json");
}

const CREATED_AT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value && "text" in value && "done" in value && "createdAt" in value)) return false;
  const { id, text, done, createdAt } = value;
  return (
    typeof id === "number" &&
    Number.isInteger(id) &&
    id > 0 &&
    typeof text === "string" &&
    typeof done === "boolean" &&
    typeof createdAt === "string" &&
    CREATED_AT_FORMAT.test(createdAt)
  );
}

export function readTasks(path: string): StoreReadResult {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ok: true, tasks: [] };
    }
    return { ok: false, path };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, path };
  }
  if (!Array.isArray(parsed) || !parsed.every(isTask)) return { ok: false, path };
  return { ok: true, tasks: parsed };
}

export function writeTasks(path: string, tasks: TaskList): StoreWriteResult {
  try {
    writeFileSync(path, JSON.stringify(tasks, null, 2), "utf8");
  } catch {
    return { ok: false, path };
  }
  return { ok: true };
}

export function nextTaskId(tasks: TaskList): number {
  return tasks.reduce((highest, task) => Math.max(highest, task.id), 0) + 1;
}

export function createTask(id: number, text: string, now: Date): Task {
  return { id, text, done: false, createdAt: now.toISOString() };
}
