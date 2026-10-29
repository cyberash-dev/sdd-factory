import type { TaskSpec } from "../../shared/design-files/tasks-json.js";
import type { DesignBundle, DesignSource } from "../ports/outbound/design-source.js";

export class UnknownTaskError extends Error {
  override readonly name = "UnknownTaskError";
}

export interface DesignCache {
  load(): Promise<DesignBundle>;
  reload(): Promise<DesignBundle>;
}

export function createDesignCache(source: DesignSource, productDir: string): DesignCache {
  let cached: Promise<DesignBundle> | null = null;
  const reload = (): Promise<DesignBundle> => {
    cached = source.load(productDir);
    return cached;
  };
  return {
    load: () => cached ?? reload(),
    reload,
  };
}

export function taskEntryOf(design: DesignBundle, taskId: string): TaskSpec {
  const task = design.tasks.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) {
    throw new UnknownTaskError(`${taskId} is not in design/tasks.json`);
  }
  return task;
}
