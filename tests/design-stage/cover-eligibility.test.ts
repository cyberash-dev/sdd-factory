import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPlanEffect } from "../../src/design-stage/application/plan-effect.js";
import type { CommandRequest, CommandResult } from "../../src/design-stage/ports/outbound/command-runner.js";
import { handoffPathIn, handoffText, harness, PLANNER_HANDOFF_LINES, stateIn, tasksJsonText, techMdText, verificationMdText, writeVia, type RoleScript, type TaskInput } from "./harness.js";

interface ProductRecord {
  readonly id: string;
  readonly type: string;
  readonly obligationLines: readonly string[];
}

const PREDICATE_OBLIGATION: readonly string[] = ["test_obligation:", "  predicate: observable at the boundary"];

function specWithEveryTemplateClass(externalDependencyObligation: readonly string[]): readonly ProductRecord[] {
  return [
    { id: "todo-cli:BEH-001", type: "Behavior", obligationLines: PREDICATE_OBLIGATION },
    { id: "todo-cli:GA-001", type: "GeneratedArtifact", obligationLines: PREDICATE_OBLIGATION },
    { id: "todo-cli:LOC-001", type: "LocalizationContract", obligationLines: PREDICATE_OBLIGATION },
    { id: "todo-cli:EXT-001", type: "ExternalDependency", obligationLines: externalDependencyObligation },
    { id: "todo-cli:SUR-001", type: "Surface", obligationLines: [] },
    { id: "todo-cli:OQ-001", type: "Open-Q", obligationLines: [] },
    { id: "todo-cli:ASM-001", type: "ASSUMPTION", obligationLines: [] },
  ];
}

function specMarkdown(records: readonly ProductRecord[]): string {
  const fences = records.flatMap((record) => ["```yaml", "---", `id: ${record.id}`, `type: ${record.type}`, "lifecycle:", "  status: approved", ...record.obligationLines, "---", "```"]);
  return ["# spec", ...fences].join("\n");
}

function sddListing(records: readonly ProductRecord[]): (request: CommandRequest) => CommandResult | null {
  const listed = records.map((record, index) => ({ id: record.id, type: record.type, status: "approved", title: null, file: "spec/spec.md", line: 3 + index * 9 }));
  const stdout = JSON.stringify({ format_version: 1, count: listed.length, records: listed });
  return (request) => (request.file === "npx" && request.args[0] === "sdd" ? { exitCode: 0, stdout, stderr: "" } : null);
}

function plannerCovering(tasks: readonly TaskInput[]): RoleScript {
  return async (request) => {
    await writeVia(request, "design/tasks.json", tasksJsonText(tasks));
    await writeVia(request, "design/plan.md", "# Plan: todo-cli\n");
    await writeVia(request, handoffPathIn(request), handoffText("planner", 1, PLANNER_HANDOFF_LINES));
  };
}

async function seedProduct(productDir: string, records: readonly ProductRecord[]): Promise<void> {
  await writeFile(join(productDir, "spec", "spec.md"), specMarkdown(records), "utf8");
  await mkdir(join(productDir, "design"), { recursive: true });
  await writeFile(join(productDir, "design", "tech.md"), techMdText(), "utf8");
  await writeFile(join(productDir, "design", "verification.md"), verificationMdText(["todo-cli:BEH-001"]), "utf8");
}

describe("task cover eligibility", () => {
  // @covers design-stage:DLT-008
  // @covers design-stage:INV-001
  it("announces the tasks when they cover the Behavior, the GeneratedArtifact and the LocalizationContract", async () => {
    const records = specWithEveryTemplateClass(["test_obligation:", "  not_applicable: the provider owns the call"]);
    const tasks: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:BEH-001", "todo-cli:GA-001"], writes: ["src/cli/**", "tests/cli/**"], designRefs: ["M-01"] },
      { id: "T-002", covers: ["todo-cli:LOC-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], dependsOn: ["T-001"], designRefs: ["M-02"] },
    ];
    const h = await harness({ scripts: { planner: [plannerCovering(tasks)] }, command: sddListing(records) });
    await seedProduct(h.productDir, records);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.tasks.ready", undefined]]);
  });

  // @covers design-stage:DLT-008
  // @covers design-stage:INV-001
  // @covers design-stage:CTR-003
  it("routes a tasks.json that omits the GeneratedArtifact to the planner as uncovered_id", async () => {
    const records = specWithEveryTemplateClass(["test_obligation:", "  not_applicable: the provider owns the call"]);
    const tasks: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:BEH-001"], writes: ["src/cli/**", "tests/cli/**"], designRefs: ["M-01"] },
      { id: "T-002", covers: ["todo-cli:LOC-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], dependsOn: ["T-001"], designRefs: ["M-02"] },
    ];
    const h = await harness({ scripts: { planner: [plannerCovering(tasks)] }, command: sddListing(records) });
    await seedProduct(h.productDir, records);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.rework", "uncovered_id: todo-cli:GA-001"]]);
  });

  // @covers design-stage:DLT-008
  // @covers design-stage:CTR-003
  it.each([
    ["a not_applicable mapping", ["test_obligation:", "  not_applicable: the provider owns the call"]],
    ["a not_applicable string", ['test_obligation: "not_applicable: the provider owns the call"']],
  ])("routes a tasks.json that covers the ExternalDependency with %s obligation to the planner as unknown_cover", async (_label, obligationLines) => {
    const records = specWithEveryTemplateClass(obligationLines);
    const tasks: TaskInput[] = [
      { id: "T-001", covers: ["todo-cli:BEH-001", "todo-cli:GA-001"], writes: ["src/cli/**", "tests/cli/**"], designRefs: ["M-01"] },
      { id: "T-002", covers: ["todo-cli:LOC-001", "todo-cli:EXT-001"], writes: ["src/index.ts", "package.json", "tsconfig.json", "tests/e2e/**"], dependsOn: ["T-001"], designRefs: ["M-02"] },
    ];
    const h = await harness({ scripts: { planner: [plannerCovering(tasks)] }, command: sddListing(records) });
    await seedProduct(h.productDir, records);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.rework", "unknown_cover: todo-cli:EXT-001 (T-002)"]]);
  });

  // @covers design-stage:DLT-008
  it("tells the planner the Behavior, GeneratedArtifact and LocalizationContract ids as the eligible ids", async () => {
    const records = specWithEveryTemplateClass(["test_obligation:", "  not_applicable: the provider owns the call"]);
    const h = await harness({ scripts: { planner: [plannerCovering([])] }, command: sddListing(records) });
    await seedProduct(h.productDir, records);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(/^- eligible_ids: (.*)$/m.exec(h.roleCalls[0]?.message ?? "")?.[1]).toBe("todo-cli:BEH-001, todo-cli:GA-001, todo-cli:LOC-001");
  });

  // @covers design-stage:DLT-008
  it.each([
    ["Migration", "todo-cli:MIG-001"],
    ["Delta", "todo-cli:DLT-001"],
    ["GeneratedArtifact", "todo-cli:GA-001"],
    ["ExternalDependency", "todo-cli:EXT-001"],
    ["LocalizationContract", "todo-cli:LOC-001"],
  ])("counts an approved %s record with a test obligation among the eligible ids", async (type, id) => {
    const records: ProductRecord[] = [
      { id: "todo-cli:BEH-001", type: "Behavior", obligationLines: PREDICATE_OBLIGATION },
      { id, type, obligationLines: PREDICATE_OBLIGATION },
    ];
    const h = await harness({ scripts: { planner: [plannerCovering([])] }, command: sddListing(records) });
    await seedProduct(h.productDir, records);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(/^- eligible_ids: (.*)$/m.exec(h.roleCalls[0]?.message ?? "")?.[1]).toBe(`todo-cli:BEH-001, ${id}`);
  });

  // @covers design-stage:DLT-008
  it("keeps every Behavior, Contract, Invariant, Scenario, NFR, Constraint and Policy record eligible", async () => {
    const records: ProductRecord[] = [
      { id: "todo-cli:BEH-001", type: "Behavior", obligationLines: PREDICATE_OBLIGATION },
      { id: "todo-cli:CTR-001", type: "Contract", obligationLines: PREDICATE_OBLIGATION },
      { id: "todo-cli:INV-001", type: "Invariant", obligationLines: PREDICATE_OBLIGATION },
      { id: "todo-cli:SCN-001", type: "Scenario", obligationLines: PREDICATE_OBLIGATION },
      { id: "todo-cli:NFR-001", type: "NFR", obligationLines: PREDICATE_OBLIGATION },
      { id: "todo-cli:CST-001", type: "Constraint", obligationLines: PREDICATE_OBLIGATION },
      { id: "todo-cli:POL-001", type: "Policy", obligationLines: PREDICATE_OBLIGATION },
    ];
    const h = await harness({ scripts: { planner: [plannerCovering([])] }, command: sddListing(records) });
    await seedProduct(h.productDir, records);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), h.slice, h.commandRunner);

    expect(/^- eligible_ids: (.*)$/m.exec(h.roleCalls[0]?.message ?? "")?.[1]).toBe("todo-cli:BEH-001, todo-cli:CTR-001, todo-cli:INV-001, todo-cli:SCN-001, todo-cli:NFR-001, todo-cli:CST-001, todo-cli:POL-001");
  });
});
