import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPlanEffect } from "../../src/design-stage/application/plan-effect.js";
import { handoffPathIn, handoffText, harness, PLANNER_HANDOFF_LINES, readVia, stateIn, tasksJsonText, techMdText, VALID_TASKS, verificationMdText, writeVia, type RoleScript, type TaskInput } from "./harness.js";

function plannerWriting(tasks: readonly TaskInput[], handoffLines: readonly string[] = PLANNER_HANDOFF_LINES): RoleScript {
  return async (request) => {
    await readVia(request, "design/tech.md");
    await readVia(request, "design/verification.md");
    await writeVia(request, "design/tasks.json", tasksJsonText(tasks));
    await writeVia(request, "design/plan.md", "# Plan: todo-cli\n");
    await writeVia(request, handoffPathIn(request), handoffText("planner", 1, handoffLines));
  };
}

async function seedDesign(productDir: string, techMd: string): Promise<void> {
  await mkdir(join(productDir, "design"), { recursive: true });
  await writeFile(join(productDir, "design", "tech.md"), techMd, "utf8");
  await writeFile(join(productDir, "design", "verification.md"), verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]), "utf8");
}

const npmCalls = (h: { readonly commands: readonly { readonly file: string; readonly args: readonly string[] }[] }) => h.commands.filter((call) => call.file === "npm" || call.file === "git").map((call) => [call.file, ...call.args].join(" "));

describe("design.plan effect", () => {
  // @covers design-stage:BEH-002
  it("publishes design.tasks.ready with path, taskCount and task summaries for a valid tasks.json", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["path"], event.payload["taskCount"], event.payload["tasks"], event.payload["changedTaskIds"]])).toEqual([
      [
        "design.tasks.ready",
        "design/tasks.json",
        2,
        [
          { id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-002"], writes: ["src/cli/**", "tests/cli/**"], dependsOn: [] },
          { id: "T-002", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], dependsOn: ["T-001"] },
        ],
        [],
      ],
    ]);
  });

  // @covers design-stage:BEH-002
  // @covers design-stage:INV-002
  it("routes overlapping writes to the planner as design.rework naming the rule and both tasks", async () => {
    const overlapping: TaskInput[] = [{ id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-002"], writes: ["src/**", "tests/cli/**"] }, { id: "T-002", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], designRefs: ["M-02"] }];
    const h = await harness({ scripts: { planner: [plannerWriting(overlapping)] } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect([h.published.map((event) => [event.type, event.payload["target"], event.payload["attempt"]]), String(h.published[0]?.payload["reason"]).startsWith("overlapping_writes: T-001, T-002: src/"), npmCalls(h)]).toEqual([[["design.rework", "planner", 1]], true, []]);
  });

  // @covers design-stage:DLT-004
  it("routes a four-task chain to the planner as design.rework naming graph_too_deep, the chain and the cap values", async () => {
    const chain: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-002", "todo-cli:CST-001"], writes: ["src/cli/**", "tests/cli/**"] },
      { id: "T-002", covers: [], writes: ["src/store/**", "tests/store/**"], dependsOn: ["T-001"] },
      { id: "T-003", covers: [], writes: ["src/report/**", "tests/report/**"], dependsOn: ["T-002"] },
      { id: "T-004", covers: [], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], dependsOn: ["T-003"], designRefs: ["M-02"] },
    ];
    const h = await harness({ scripts: { planner: [plannerWriting(chain)] }, caps: { graphDepth: 3, minCoversPerTask: 3 } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["target"], event.payload["reason"]])).toEqual([
      ["design.rework", "planner", "graph_too_deep: T-001, T-002, T-003, T-004; task_too_small: T-002 (0 covers), T-003 (0 covers); caps: graphDepth 3, minCoversPerTask 3"],
    ]);
  });

  // @covers design-stage:DLT-004
  it("tells the planner the graphDepth and minCoversPerTask caps in its message", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] }, caps: { graphDepth: 4, minCoversPerTask: 2 } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect([h.roleCalls[0]?.message.includes("- graph_depth: 4"), h.roleCalls[0]?.message.includes("- min_covers_per_task: 2")]).toEqual([true, true]);
  });

  // @covers design-stage:BEH-002
  it("passes the validator message as rework_finding on the second attempt and numbers the rework by the stage counters", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] } });
    await seedDesign(h.productDir, techMdText());
    const state = stateIn("planning", { stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 1, architectRepairs: 0, assemblyRounds: 0 } });

    await runPlanEffect({ kind: "design.plan", attempt: 2, reworkFinding: "overlapping_writes: T-001, T-002: src/index.ts" }, h.context(state), h.slice, h.commandRunner);

    expect([h.roleCalls[0]?.message.includes("- attempt: 2"), h.roleCalls[0]?.message.includes("- rework_finding: overlapping_writes: T-001, T-002: src/index.ts"), h.published.map((event) => event.type)]).toEqual([true, true, ["design.tasks.ready"]]);
  });

  // @covers design-stage:INV-001
  it("routes an uncovered approved id to the planner and ignores Surface, Open-Q and proposed records", async () => {
    const partial: TaskInput[] = [{ id: "T-001", covers: ["todo-cli:CTR-001", "todo-cli:BEH-002"], writes: ["src/cli/**", "tests/cli/**"] }, { id: "T-002", covers: [], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], designRefs: ["M-02"] }];
    const h = await harness({ scripts: { planner: [plannerWriting(partial)] } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.rework", "uncovered_id: todo-cli:CST-001"]]);
  });

  // @covers design-stage:BEH-002
  it("treats non-empty uncovered_ids in a complete handoff as a validation failure", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS, ["status: complete", "tasks_path: design/tasks.json", "task_count: 2", "uncovered_ids: [todo-cli:CST-001]"])] } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.rework", "uncovered_ids: todo-cli:CST-001"]]);
  });

  // @covers design-stage:CTR-003
  it("routes a tasks.json schema error to the planner naming the offending task and field", async () => {
    const broken: RoleScript = async (request) => {
      await writeVia(request, "design/tasks.json", tasksJsonText(VALID_TASKS).replace('"maxTests": 8', '"maxTests": 0'));
      await writeVia(request, handoffPathIn(request), handoffText("planner", 1, PLANNER_HANDOFF_LINES));
    };
    const h = await harness({ scripts: { planner: [broken] } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.rework", "schema: task T-001: field testBudget.maxTests must be a positive integer"]]);
  });

  // @covers design-stage:BEH-003
  it("installs the pinned dependencies with --save-exact, overwrites compilerOptions and commits on integration before announcing tasks", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] } });
    await seedDesign(h.productDir, techMdText({ dependencies: ["yaml@2.9.1"], devDependencies: ["typescript@7.0.2", "vitest@5.0.5"], tsconfig: "{ module: NodeNext, strict: true }" }));
    const context = h.context(stateIn("planning"));
    let commandsBeforePublish = -1;
    const observed = {
      ...context,
      publish: (event: Parameters<typeof context.publish>[0]) => {
        commandsBeforePublish = h.commands.length;
        context.publish(event);
      },
    };

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, observed, h.slice, h.commandRunner);

    const tsconfig: unknown = JSON.parse(await readFile(join(h.productDir, "tsconfig.json"), "utf8"));
    expect([npmCalls(h), tsconfig, h.published.map((event) => event.type), commandsBeforePublish]).toEqual([
      ["npm install --no-audit --no-fund --save-exact yaml@2.9.1", "npm install --no-audit --no-fund --save-dev --save-exact typescript@7.0.2 vitest@5.0.5", "git rev-parse --abbrev-ref HEAD", "git add -- package.json tsconfig.json", "git commit -m design: tooling"],
      { compilerOptions: { module: "NodeNext", strict: true, skipLibCheck: true, typeRoots: ["./node_modules/@types"] }, include: ["src"] },
      ["design.tasks.ready"],
      6,
    ]);
  });

  // @covers design-stage:BEH-003
  // @covers design-stage:DLT-002
  it("drops rootDir from the architect's compilerOptions so the typecheck keeps covering tests", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] } });
    await seedDesign(h.productDir, techMdText({ tsconfig: '{ strict: true, rootDir: "src", outDir: "dist" }' }));

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    const tsconfig: unknown = JSON.parse(await readFile(join(h.productDir, "tsconfig.json"), "utf8"));
    expect([tsconfig, h.log.includes("design-stage: tsconfig rootDir dropped")]).toEqual([{ compilerOptions: { strict: true, outDir: "dist", skipLibCheck: true, typeRoots: ["./node_modules/@types"] }, include: ["src"] }, true]);
  });

  // @covers design-stage:DLT-006
  it("pins skipLibCheck and typeRoots next to the architect's compilerOptions and keeps include as scaffolded", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] } });
    await seedDesign(h.productDir, techMdText({ tsconfig: "{ module: NodeNext, strict: true }" }));

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    const tsconfig: unknown = JSON.parse(await readFile(join(h.productDir, "tsconfig.json"), "utf8"));
    expect(tsconfig).toEqual({ compilerOptions: { module: "NodeNext", strict: true, skipLibCheck: true, typeRoots: ["./node_modules/@types"] }, include: ["src"] });
  });

  // @covers design-stage:DLT-006
  it("overrides an architect skipLibCheck false with the pinned true and logs the pin", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] } });
    await seedDesign(h.productDir, techMdText({ tsconfig: "{ strict: true, skipLibCheck: false }" }));

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    const tsconfig: unknown = JSON.parse(await readFile(join(h.productDir, "tsconfig.json"), "utf8"));
    expect([tsconfig, h.log.includes("design-stage: tsconfig skipLibCheck and typeRoots pinned")]).toEqual([
      { compilerOptions: { strict: true, skipLibCheck: true, typeRoots: ["./node_modules/@types"] }, include: ["src"] },
      true,
    ]);
  });

  // @covers design-stage:BEH-003
  it("installs nothing and commits nothing when both lists are empty and there is no tsconfig key", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS)] } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect([npmCalls(h), h.published.map((event) => event.type)]).toEqual([[], ["design.tasks.ready"]]);
  });

  // @covers design-stage:BEH-003
  it("fails the run with tooling_broken and the npm output tail when the install exits non-zero", async () => {
    const h = await harness({
      scripts: { planner: [plannerWriting(VALID_TASKS)] },
      command: (request) => (request.file === "npm" ? { exitCode: 1, stdout: "", stderr: "npm ERR! 404 Not Found - typescript@9.9.9" } : null),
    });
    await seedDesign(h.productDir, techMdText({ devDependencies: ["typescript@9.9.9"] }));

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["stage"], event.payload["reason"], event.payload["detail"]])).toEqual([["run.failed", "design", "tooling_broken", "npm install exited 1: npm ERR! 404 Not Found - typescript@9.9.9"]]);
  });

  it("refuses to commit tooling on a branch other than integration", async () => {
    const h = await harness({
      scripts: { planner: [plannerWriting(VALID_TASKS)] },
      command: (request) => (request.file === "git" && request.args[0] === "rev-parse" ? { exitCode: 0, stdout: "main\n", stderr: "" } : null),
    });
    await seedDesign(h.productDir, techMdText({ devDependencies: ["typescript@7.0.2"] }));

    await expect(runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner)).rejects.toThrow("product repo is on main");
  });

  // @covers design-stage:BEH-004
  it("on a re-cut during build accepts a merge of the tasks named by the finding, reports them as changed and installs nothing", async () => {
    const previous: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"] },
      { id: "T-002", covers: ["todo-cli:BEH-002"], writes: ["src/store/**", "tests/store/**"] },
      { id: "T-003", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], designRefs: ["M-02"] },
    ];
    const merged: TaskInput[] = [previous[0] ?? { id: "", covers: [], writes: [] }, { id: "T-002", covers: ["todo-cli:BEH-002", "todo-cli:CST-001"], writes: ["src/store/**", "src/index.ts", "package.json", "tsconfig.json", "tests/store/**", "tests/e2e/**"], designRefs: ["M-01", "M-02"] }];
    const h = await harness({ scripts: { planner: [plannerWriting(merged)] } });
    await seedDesign(h.productDir, techMdText({ devDependencies: ["typescript@7.0.2"] }));
    await writeFile(join(h.productDir, "design", "tasks.json"), tasksJsonText(previous), "utf8");

    await runPlanEffect({ kind: "design.plan", attempt: 2, reworkFinding: "TASK-OVERFLOW from T-002: needs src/index.ts owned elsewhere" }, h.context(stateIn("building")), h.slice, h.commandRunner);

    expect([npmCalls(h), h.published.map((event) => [event.type, event.payload["taskCount"], event.payload["changedTaskIds"]])]).toEqual([[], [["design.tasks.ready", 2, ["T-002", "T-003"]]]]);
  });

  // @covers design-stage:BEH-004
  it("on a re-cut during build rejects a change to a task the finding did not name as unrelated_task_changed", async () => {
    const previous: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"] },
      { id: "T-002", covers: ["todo-cli:BEH-002"], writes: ["src/store/**", "tests/store/**"] },
      { id: "T-003", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], designRefs: ["M-02"] },
    ];
    const rewritten: TaskInput[] = [{ ...(previous[0] ?? { id: "", covers: [], writes: [] }), title: "renamed" }, { ...(previous[1] ?? { id: "", covers: [], writes: [] }), writes: ["src/store/**", "src/report/**", "tests/store/**"] }, previous[2] ?? { id: "", covers: [], writes: [] }];
    const h = await harness({ scripts: { planner: [plannerWriting(rewritten)] } });
    await seedDesign(h.productDir, techMdText());
    await writeFile(join(h.productDir, "design", "tasks.json"), tasksJsonText(previous), "utf8");

    await runPlanEffect({ kind: "design.plan", attempt: 2, reworkFinding: "TASK-OVERFLOW from T-002: needs src/report/**" }, h.context(stateIn("building")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.rework", "unrelated_task_changed: T-001"]]);
  });

  // @covers build-stage:DLT-008
  // @covers build-stage:BEH-009
  it("on a re-cut during build reports the task whose finding caused it as changed even when its record is unchanged", async () => {
    const previous: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"] },
      { id: "T-002", covers: ["todo-cli:BEH-002"], writes: ["src/store/**", "tests/store/**"] },
      { id: "T-003", covers: ["todo-cli:CST-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], designRefs: ["M-02"] },
    ];
    const h = await harness({ scripts: { planner: [plannerWriting(previous)] } });
    await seedDesign(h.productDir, techMdText({ devDependencies: ["typescript@7.0.2"] }));
    await writeFile(join(h.productDir, "design", "tasks.json"), tasksJsonText(previous), "utf8");

    await runPlanEffect({ kind: "design.plan", attempt: 2, reworkFinding: "TASK-OVERFLOW from T-001: budget exceeded", originTaskId: "T-001" }, h.context(stateIn("building")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["changedTaskIds"]])).toEqual([["design.tasks.ready", ["T-001"]]]);
  });

  // @covers build-stage:DLT-008
  it("keeps the origin task on the design.rework of a re-cut that failed validation", async () => {
    const previous: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:CTR-001"], writes: ["src/cli/**", "tests/cli/**"] },
      { id: "T-002", covers: ["todo-cli:BEH-002"], writes: ["src/store/**", "tests/store/**"] },
    ];
    const overlapping: TaskInput[] = [previous[0] ?? { id: "", covers: [], writes: [] }, { id: "T-002", covers: ["todo-cli:BEH-002"], writes: ["src/cli/**", "src/store/**", "tests/store/**"] }];
    const h = await harness({ scripts: { planner: [plannerWriting(overlapping)] } });
    await seedDesign(h.productDir, techMdText());
    await writeFile(join(h.productDir, "design", "tasks.json"), tasksJsonText(previous), "utf8");

    await runPlanEffect({ kind: "design.plan", attempt: 2, reworkFinding: "TASK-OVERFLOW from T-002: needs src/cli/**", originTaskId: "T-002" }, h.context(stateIn("building")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["originTaskId"]])).toEqual([["design.rework", "T-002"]]);
  });

  it("blocks the design with planner_blocked when the planner reports status blocked", async () => {
    const h = await harness({ scripts: { planner: [plannerWriting(VALID_TASKS, ["status: blocked", "tasks_path: design/tasks.json", "task_count: 0", "uncovered_ids: [todo-cli:CST-001]"])] } });
    await seedDesign(h.productDir, techMdText());

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.blocked", "planner_blocked"]]);
  });
});
