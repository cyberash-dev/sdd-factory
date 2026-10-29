import type { TaskSpec, TasksFile } from "../../shared/design-files/tasks-json.js";
import { anyGlobMatches } from "./glob.js";

export interface TasksValidationInput {
  readonly tasks: TasksFile;
  readonly eligibleIds: readonly string[];
  readonly moduleIds: readonly string[];
  readonly modulePaths: readonly string[];
  readonly existingPaths: readonly string[];
}

export interface TasksViolation {
  readonly rule: string;
  readonly ids: readonly string[];
}

export const SHARED_FILES: readonly string[] = ["package.json", "tsconfig.json", "src/index.ts"];

function coverageViolations(tasks: readonly TaskSpec[], eligibleIds: readonly string[]): TasksViolation[] {
  const eligible = new Set(eligibleIds);
  const owners = new Map<string, string[]>();
  for (const task of tasks) {
    for (const id of task.covers) {
      owners.set(id, [...(owners.get(id) ?? []), task.id]);
    }
  }
  const violations: TasksViolation[] = [];
  const unknown = [...owners].filter(([id]) => !eligible.has(id)).map(([id, taskIds]) => `${id} (${taskIds.join(", ")})`);
  if (unknown.length > 0) {
    violations.push({ rule: "unknown_cover", ids: unknown });
  }
  const uncovered = eligibleIds.filter((id) => !owners.has(id));
  if (uncovered.length > 0) {
    violations.push({ rule: "uncovered_id", ids: uncovered });
  }
  const twice = [...owners].filter(([, taskIds]) => taskIds.length > 1).map(([id, taskIds]) => `${id} (${taskIds.join(", ")})`);
  if (twice.length > 0) {
    violations.push({ rule: "id_covered_twice", ids: twice });
  }
  return violations;
}

function globAreaViolations(tasks: readonly TaskSpec[]): TasksViolation[] {
  const violations: TasksViolation[] = [];
  const withoutSrc = tasks.filter((task) => !task.writes.some((glob) => glob.startsWith("src/"))).map((task) => task.id);
  if (withoutSrc.length > 0) {
    violations.push({ rule: "missing_src_glob", ids: withoutSrc });
  }
  const withoutTests = tasks.filter((task) => !task.writes.some((glob) => glob.startsWith("tests/"))).map((task) => task.id);
  if (withoutTests.length > 0) {
    violations.push({ rule: "missing_tests_glob", ids: withoutTests });
  }
  return violations;
}

function candidatePaths(input: TasksValidationInput): readonly string[] {
  const writes = input.tasks.tasks.flatMap((task) => task.writes);
  return [...new Set([...input.existingPaths, ...input.modulePaths, ...writes, ...SHARED_FILES])];
}

function overlapViolations(tasks: readonly TaskSpec[], candidates: readonly string[]): TasksViolation[] {
  const overlaps: string[] = [];
  for (let left = 0; left < tasks.length; left += 1) {
    for (let right = left + 1; right < tasks.length; right += 1) {
      const first = tasks[left];
      const second = tasks[right];
      if (first === undefined || second === undefined) {
        continue;
      }
      const witness = candidates.find((path) => anyGlobMatches(first.writes, path) && anyGlobMatches(second.writes, path));
      if (witness !== undefined) {
        overlaps.push(`${first.id}, ${second.id}: ${witness}`);
      }
    }
  }
  return overlaps.length > 0 ? [{ rule: "overlapping_writes", ids: overlaps }] : [];
}

function sharedFileViolations(tasks: readonly TaskSpec[], present: ReadonlySet<string>): TasksViolation[] {
  const unowned = SHARED_FILES.filter((file) => present.has(file) && !tasks.some((task) => anyGlobMatches(task.writes, file)));
  return unowned.length > 0 ? [{ rule: "shared_file_unowned", ids: unowned }] : [];
}

function findCycle(tasks: readonly TaskSpec[]): readonly string[] | null {
  const edges = new Map(tasks.map((task) => [task.id, task.dependsOn] as const));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): readonly string[] | null => {
    const mark = state.get(id);
    if (mark === "done") {
      return null;
    }
    if (mark === "visiting") {
      return [...stack.slice(stack.indexOf(id)), id];
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) {
        continue;
      }
      const cycle = visit(next);
      if (cycle !== null) {
        return cycle;
      }
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
}

function dependencyViolations(tasks: readonly TaskSpec[]): TasksViolation[] {
  const known = new Set(tasks.map((task) => task.id));
  const violations: TasksViolation[] = [];
  const dangling = tasks.flatMap((task) => task.dependsOn.filter((dependency) => !known.has(dependency)).map((dependency) => `${task.id} -> ${dependency}`));
  if (dangling.length > 0) {
    violations.push({ rule: "unknown_dependency", ids: dangling });
  }
  const cycle = findCycle(tasks);
  if (cycle !== null) {
    violations.push({ rule: "dependency_cycle", ids: cycle });
  }
  return violations;
}

function designRefViolations(tasks: readonly TaskSpec[], moduleIds: readonly string[]): TasksViolation[] {
  const known = new Set(moduleIds);
  const unknown = tasks.flatMap((task) => task.designRefs.filter((ref) => !known.has(ref)).map((ref) => `${task.id} -> ${ref}`));
  return unknown.length > 0 ? [{ rule: "unknown_design_ref", ids: unknown }] : [];
}

export function validateTasks(input: TasksValidationInput): readonly TasksViolation[] {
  const tasks = input.tasks.tasks;
  const candidates = candidatePaths(input);
  const present = new Set([...input.existingPaths, ...input.modulePaths]);
  return [
    ...coverageViolations(tasks, input.eligibleIds),
    ...globAreaViolations(tasks),
    ...overlapViolations(tasks, candidates),
    ...sharedFileViolations(tasks, present),
    ...dependencyViolations(tasks),
    ...designRefViolations(tasks, input.moduleIds),
  ];
}

export function describeViolations(violations: readonly TasksViolation[]): string {
  return violations.map((violation) => `${violation.rule}: ${violation.ids.join(", ")}`).join("; ");
}
