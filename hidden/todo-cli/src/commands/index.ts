import { makeError } from "../errors/index.js";
import type { CliError } from "../errors/index.js";
import type { Task, TaskList } from "../store/index.js";
import { formatCreatedAt } from "../store/index.js";

export type CommandOutcome =
  | { readonly ok: true; readonly lines: readonly string[]; readonly list: TaskList | null }
  | { readonly ok: false; readonly error: CliError };

function succeed(lines: readonly string[], list: TaskList | null): CommandOutcome {
  return { ok: true, lines, list };
}

function noTask(idToken: string): CommandOutcome {
  return { ok: false, error: makeError("E_NO_TASK", idToken) };
}

function findTask(list: TaskList, idToken: string): Task | undefined {
  if (!/^\d+$/.test(idToken)) return undefined;
  const id = Number(idToken);
  return list.tasks.find((task) => task.id === id);
}

export function runAdd(list: TaskList, text: string, clock: () => Date): CommandOutcome {
  const task: Task = {
    id: list.nextId,
    text,
    done: false,
    createdAt: formatCreatedAt(clock()),
  };
  return succeed([`#${task.id} ${task.text}`], {
    nextId: list.nextId + 1,
    tasks: [...list.tasks, task],
  });
}

export function runList(list: TaskList, all: boolean): CommandOutcome {
  const lines = [...list.tasks]
    .filter((task) => all || !task.done)
    .sort((a, b) => a.id - b.id)
    .map((task) => (task.done ? `[x] #${task.id} ${task.text}` : `#${task.id} ${task.text}`));
  return succeed(lines, null);
}

export function runDone(list: TaskList, idToken: string): CommandOutcome {
  const target = findTask(list, idToken);
  if (target === undefined) return noTask(idToken);
  const tasks = list.tasks.map((task) => (task === target ? { ...task, done: true } : task));
  return succeed([`#${idToken} done`], { nextId: list.nextId, tasks });
}

export function runRm(list: TaskList, idToken: string): CommandOutcome {
  const target = findTask(list, idToken);
  if (target === undefined) return noTask(idToken);
  const tasks = list.tasks.filter((task) => task !== target);
  return succeed([`#${idToken} removed`], { nextId: list.nextId, tasks });
}
