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

/* Shape parsing only; the design-stage slice owns the semantic validation (coverage, disjoint writes, DAG). */
export function parseTasksJson(_text: string): TasksFile {
  throw new TasksJsonParseError("parseTasksJson is not implemented yet");
}
