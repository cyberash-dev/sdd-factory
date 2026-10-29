export interface TaskSpec {
  readonly id: string;
  readonly title: string;
  readonly covers: readonly string[];
  readonly writes: readonly string[];
  readonly dependsOn: readonly string[];
  readonly designRefs: readonly string[];
  readonly testBudget: { readonly maxTests: number };
  readonly reworkRoute: { readonly onImplementationFailure: "implementer"; readonly onTestContractConflict: "reviewer" };
}

export interface TasksFile {
  readonly schemaVersion: 1;
  readonly partition: string;
  readonly tasks: readonly TaskSpec[];
}

export class TasksJsonParseError extends Error {
  override readonly name = "TasksJsonParseError";
}

const TASK_ID = /^T-\d{3}$/;
const ROOT_KEYS = ["schemaVersion", "partition", "tasks"];
const TASK_KEYS = ["id", "title", "covers", "writes", "dependsOn", "designRefs", "testBudget", "reworkRoute"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], scope: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new TasksJsonParseError(`${scope}: unknown field ${key}`);
    }
  }
}

function stringList(task: Record<string, unknown>, field: string, scope: string): readonly string[] {
  const value = task[field];
  if (!isStringArray(value)) {
    throw new TasksJsonParseError(`${scope}: field ${field} must be an array of strings`);
  }
  return value;
}

function parseTask(raw: unknown, index: number): TaskSpec {
  if (!isRecord(raw)) {
    throw new TasksJsonParseError(`tasks[${index}]: must be an object`);
  }
  const id = raw["id"];
  if (typeof id !== "string" || !TASK_ID.test(id)) {
    throw new TasksJsonParseError(`tasks[${index}]: field id must match T-NNN`);
  }
  const scope = `task ${id}`;
  rejectUnknownKeys(raw, TASK_KEYS, scope);
  const title = raw["title"];
  if (typeof title !== "string" || title.length === 0) {
    throw new TasksJsonParseError(`${scope}: field title must be a non-empty string`);
  }
  const testBudget = raw["testBudget"];
  if (!isRecord(testBudget) || !Number.isInteger(testBudget["maxTests"]) || typeof testBudget["maxTests"] !== "number" || testBudget["maxTests"] < 1) {
    throw new TasksJsonParseError(`${scope}: field testBudget.maxTests must be a positive integer`);
  }
  const reworkRoute = raw["reworkRoute"];
  if (!isRecord(reworkRoute) || reworkRoute["onImplementationFailure"] !== "implementer" || reworkRoute["onTestContractConflict"] !== "reviewer") {
    throw new TasksJsonParseError(`${scope}: field reworkRoute must be {onImplementationFailure: "implementer", onTestContractConflict: "reviewer"}`);
  }
  return {
    id,
    title,
    covers: stringList(raw, "covers", scope),
    writes: stringList(raw, "writes", scope),
    dependsOn: stringList(raw, "dependsOn", scope),
    designRefs: stringList(raw, "designRefs", scope),
    testBudget: { maxTests: testBudget["maxTests"] },
    reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" },
  };
}

export function parseTasksJson(text: string): TasksFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TasksJsonParseError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new TasksJsonParseError("root: must be an object");
  }
  rejectUnknownKeys(parsed, ROOT_KEYS, "root");
  if (parsed["schemaVersion"] !== 1) {
    throw new TasksJsonParseError("root: field schemaVersion must be 1");
  }
  const partition = parsed["partition"];
  if (typeof partition !== "string" || partition.length === 0) {
    throw new TasksJsonParseError("root: field partition must be a non-empty string");
  }
  const rawTasks = parsed["tasks"];
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new TasksJsonParseError("root: field tasks must be a non-empty array");
  }
  const tasks = rawTasks.map((raw, index) => parseTask(raw, index));
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new TasksJsonParseError(`task ${task.id}: duplicate id`);
    }
    seen.add(task.id);
  }
  return { schemaVersion: 1, partition, tasks };
}
