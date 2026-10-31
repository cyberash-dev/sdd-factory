import { readFileSync, writeFileSync } from "node:fs";

export interface Task {
  readonly id: number;
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: string;
}

export interface TaskList {
  readonly nextId: number;
  readonly tasks: readonly Task[];
}

export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

const DEFAULT_STORE_PATH = "./todo.json";
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function resolveStorePath(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env["TODO_FILE"];
  return configured === undefined || configured === "" ? DEFAULT_STORE_PATH : configured;
}

export function emptyTaskList(): TaskList {
  return { nextId: 1, tasks: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function toTask(value: unknown): Task | null {
  if (!isRecord(value)) return null;
  const { id, text, done, createdAt } = value;
  if (!isPositiveInteger(id)) return null;
  if (typeof text !== "string" || text.trim() === "") return null;
  if (typeof done !== "boolean") return null;
  if (typeof createdAt !== "string" || !CREATED_AT_PATTERN.test(createdAt)) return null;
  return { id, text, done, createdAt };
}

function toTaskList(value: unknown): TaskList | null {
  if (!isRecord(value)) return null;
  const { nextId, tasks } = value;
  if (!isPositiveInteger(nextId) || !Array.isArray(tasks)) return null;
  const parsed: Task[] = [];
  let previousId = 0;
  for (const entry of tasks) {
    const task = toTask(entry);
    if (task === null || task.id <= previousId) return null;
    previousId = task.id;
    parsed.push(task);
  }
  return { nextId, tasks: parsed };
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

export function readTaskList(path: string): StoreResult<TaskList> {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    return isMissingFile(error) ? { ok: true, value: emptyTaskList() } : { ok: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false };
  }
  const list = toTaskList(parsed);
  return list === null ? { ok: false } : { ok: true, value: list };
}

export function writeTaskList(path: string, list: TaskList): StoreResult<null> {
  try {
    writeFileSync(path, JSON.stringify({ nextId: list.nextId, tasks: list.tasks }), "utf8");
  } catch {
    return { ok: false };
  }
  return { ok: true, value: null };
}

export function formatCreatedAt(date: Date): string {
  return date.toISOString();
}
