import type { RunState, TaskState } from "../../bus/domain/run-state.js";

export class TaskGraphCycleError extends Error {
  override readonly name = "TaskGraphCycleError";
}

export function allTasksApproved(state: RunState): boolean {
  return Object.values(state.tasks).every((task) => task.status === "approved");
}

export function topologicalTaskOrder(tasks: Readonly<Record<string, TaskState>>): readonly string[] {
  const pending = new Map<string, Set<string>>();
  for (const [id, task] of Object.entries(tasks).sort(([left], [right]) => left.localeCompare(right))) {
    pending.set(id, new Set(task.dependsOn.filter((dependency) => Object.hasOwn(tasks, dependency))));
  }
  const order: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending].find(([, dependencies]) => dependencies.size === 0);
    if (ready === undefined) {
      throw new TaskGraphCycleError(`dependsOn cycle among ${[...pending.keys()].join(", ")}`);
    }
    const [id] = ready;
    pending.delete(id);
    for (const dependencies of pending.values()) {
      dependencies.delete(id);
    }
    order.push(id);
  }
  return order;
}
