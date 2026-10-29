import { describe, expect, it } from "vitest";
import type { TaskSpec, TasksFile } from "../../shared/design-files/tasks-json.js";
import { describeViolations, validateTasks, type TasksValidationInput } from "./tasks-validator.js";

function task(id: string, covers: readonly string[], writes: readonly string[], overrides: Partial<TaskSpec> = {}): TaskSpec {
  return { id, title: "do the thing", covers, writes, dependsOn: [], designRefs: ["M-01"], testBudget: { maxTests: 8 }, reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" }, ...overrides };
}

function input(tasks: readonly TaskSpec[], overrides: Partial<TasksValidationInput> = {}): TasksValidationInput {
  const file: TasksFile = { schemaVersion: 1, partition: "todo-cli", tasks };
  return {
    tasks: file,
    eligibleIds: ["todo-cli:CTR-001", "todo-cli:CTR-002", "todo-cli:BEH-003"],
    moduleIds: ["M-01", "M-02"],
    modulePaths: ["src/cli/**", "src/cli/index.ts", "src/store/**", "src/store/index.ts", "src/index.ts"],
    existingPaths: ["package.json", "tsconfig.json"],
    ...overrides,
  };
}

const valid = [
  task("T-001", ["todo-cli:CTR-001"], ["src/cli/**", "tests/cli/**"]),
  task("T-002", ["todo-cli:CTR-002"], ["src/store/**", "tests/store/**"], { designRefs: ["M-02"] }),
  task("T-003", ["todo-cli:BEH-003"], ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], { dependsOn: ["T-001", "T-002"] }),
];

describe("validateTasks", () => {
  // @covers design-stage:CTR-003
  // @covers design-stage:INV-001
  it("accepts a file whose covers partition the eligible ids with disjoint writes and a DAG", () => {
    expect(validateTasks(input(valid))).toEqual([]);
  });

  // @covers design-stage:INV-001
  it("rejects an omitted eligible id as uncovered_id", () => {
    const tasks = [valid[0], valid[1], task("T-003", [], ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"])].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "uncovered_id", ids: ["todo-cli:BEH-003"] }]);
  });

  // @covers design-stage:INV-001
  it("rejects an id covered by two tasks as id_covered_twice naming both tasks", () => {
    const tasks = [valid[0], task("T-002", ["todo-cli:CTR-001", "todo-cli:CTR-002"], ["src/store/**", "tests/store/**"], { designRefs: ["M-02"] }), valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "id_covered_twice", ids: ["todo-cli:CTR-001 (T-001, T-002)"] }]);
  });

  // @covers design-stage:INV-001
  it("rejects a Surface id in covers as unknown_cover instead of requiring it", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001", "todo-cli:SUR-001"], ["src/cli/**", "tests/cli/**"]), valid[1], valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "unknown_cover", ids: ["todo-cli:SUR-001 (T-001)"] }]);
  });

  // @covers design-stage:INV-002
  it("rejects a glob nested under another task's glob as overlapping_writes naming both tasks", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["src/**", "tests/cli/**"]), task("T-002", ["todo-cli:CTR-002"], ["src/cli/**", "tests/store/**"], { designRefs: ["M-02"] }), task("T-003", ["todo-cli:BEH-003"], ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"])];

    const violations = validateTasks(input(tasks)).filter((violation) => violation.rule === "overlapping_writes");

    expect(violations).toEqual([{ rule: "overlapping_writes", ids: ["T-001, T-002: src/cli/**", "T-001, T-003: src/index.ts"] }]);
  });

  // @covers design-stage:INV-002
  it("rejects two textually different globs that match the same existing file", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["src/cli/*.ts", "tests/cli/**"]), task("T-002", ["todo-cli:CTR-002"], ["src/**/parse.ts", "tests/store/**"], { designRefs: ["M-02"] }), valid[2]].filter((item): item is TaskSpec => item !== undefined);

    const violations = validateTasks(input(tasks, { existingPaths: ["src/cli/parse.ts"] }));

    expect(violations).toEqual([{ rule: "overlapping_writes", ids: ["T-001, T-002: src/cli/parse.ts"] }]);
  });

  // @covers design-stage:INV-002
  it("accepts disjoint sibling directories under the same parent", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["src/cli/**", "tests/cli/**"]), task("T-002", ["todo-cli:CTR-002"], ["src/store/**", "tests/store/**"], { designRefs: ["M-02"] }), valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks, { existingPaths: ["src/cli/a.ts", "src/store/b.ts", "package.json", "tsconfig.json"] }))).toEqual([]);
  });

  // @covers design-stage:CTR-003
  it("rejects a task without a tests glob as missing_tests_glob", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["src/cli/**"]), valid[1], valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "missing_tests_glob", ids: ["T-001"] }]);
  });

  it("rejects a task without a src glob as missing_src_glob", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["tests/cli/**"]), valid[1], valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "missing_src_glob", ids: ["T-001"] }]);
  });

  // @covers design-stage:INV-003
  it("rejects a two-node cycle naming the cycle", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["src/cli/**", "tests/cli/**"], { dependsOn: ["T-002"] }), task("T-002", ["todo-cli:CTR-002"], ["src/store/**", "tests/store/**"], { dependsOn: ["T-001"], designRefs: ["M-02"] }), valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "dependency_cycle", ids: ["T-001", "T-002", "T-001"] }]);
  });

  // @covers design-stage:INV-003
  it("rejects a self-dependency as a cycle", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["src/cli/**", "tests/cli/**"], { dependsOn: ["T-001"] }), valid[1], valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "dependency_cycle", ids: ["T-001", "T-001"] }]);
  });

  // @covers design-stage:INV-003
  it("rejects a dangling dependsOn as unknown_dependency", () => {
    const tasks = [valid[0], valid[1], task("T-003", ["todo-cli:BEH-003"], ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], { dependsOn: ["T-009"] })].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "unknown_dependency", ids: ["T-003 -> T-009"] }]);
  });

  // @covers design-stage:INV-003
  it("accepts a diamond dependency", () => {
    const tasks = [
      task("T-001", ["todo-cli:CTR-001"], ["src/cli/**", "tests/cli/**"]),
      task("T-002", ["todo-cli:CTR-002"], ["src/store/**", "tests/store/**"], { dependsOn: ["T-001"], designRefs: ["M-02"] }),
      task("T-003", [], ["src/report/**", "tests/report/**"], { dependsOn: ["T-001"] }),
      task("T-004", ["todo-cli:BEH-003"], ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], { dependsOn: ["T-002", "T-003"] }),
    ];

    expect(validateTasks(input(tasks))).toEqual([]);
  });

  // @covers design-stage:CTR-003
  it("rejects a designRef that names no tech.md module as unknown_design_ref", () => {
    const tasks = [task("T-001", ["todo-cli:CTR-001"], ["src/cli/**", "tests/cli/**"], { designRefs: ["M-09"] }), valid[1], valid[2]].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "unknown_design_ref", ids: ["T-001 -> M-09"] }]);
  });

  // @covers design-stage:CTR-003
  it("rejects a shared file that no task owns as shared_file_unowned", () => {
    const tasks = [valid[0], valid[1], task("T-003", ["todo-cli:BEH-003"], ["src/index.ts", "tests/e2e/**"])].filter((item): item is TaskSpec => item !== undefined);

    expect(validateTasks(input(tasks))).toEqual([{ rule: "shared_file_unowned", ids: ["package.json", "tsconfig.json"] }]);
  });
});

describe("describeViolations", () => {
  it("renders rule names with their offending ids for the rework reason", () => {
    const text = describeViolations([
      { rule: "uncovered_id", ids: ["todo-cli:BEH-003"] },
      { rule: "overlapping_writes", ids: ["T-001, T-002: src/cli/**"] },
    ]);

    expect(text).toBe("uncovered_id: todo-cli:BEH-003; overlapping_writes: T-001, T-002: src/cli/**");
  });
});
