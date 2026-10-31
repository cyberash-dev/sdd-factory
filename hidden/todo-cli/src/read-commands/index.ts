import { storageError } from "../errors/index.js";
import type { CommandResult } from "../errors/index.js";
import { readTasks } from "../store/index.js";
import type { Task, TaskList } from "../store/index.js";

function renderTask(task: Task): string {
  const prefix = task.done ? "[x] " : "";
  return `${prefix}#${task.id} ${task.text}\n`;
}

export function renderList(tasks: TaskList, all: boolean): string {
  return [...tasks]
    .filter((task) => all || !task.done)
    .sort((a, b) => a.id - b.id)
    .map(renderTask)
    .join("");
}

export function runList(path: string, all: boolean): CommandResult {
  const read = readTasks(path);
  if (!read.ok) return { ok: false, error: storageError(path) };
  return { ok: true, stdout: renderList(read.tasks, all) };
}

export function usageText(): string {
  return [
    "usage: todo <command>",
    "  add <text>    add a task",
    "  list [--all]  list open tasks, or all tasks with --all",
    "  done <id>     mark a task completed",
    "  rm <id>       remove a task",
    "  --help        show this text",
    "",
  ].join("\n");
}

export function runHelp(): CommandResult {
  return { ok: true, stdout: usageText() };
}
