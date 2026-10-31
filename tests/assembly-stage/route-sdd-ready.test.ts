import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeSddReadyEffect } from "../../src/assembly-stage/application/route-sdd-ready.js";
import type { Effect } from "../../src/bus/domain/transition.js";
import type { EffectHandler } from "../../src/shared/slice.js";
import { writeTextAtomic } from "../../src/shared/fs/text.js";
import { collectingContext, runState, sddReadyReport, sliceContext, taskState, tempDir } from "./support.js";

function tasks() {
  return {
    "T-001": taskState({ covers: ["todo:BEH-001"], writes: ["src/cli/**", "tests/cli/**"], testWriterAttempts: 1 }),
    "T-002": taskState({ covers: ["todo:BEH-002"], writes: ["src/store/**", "tests/store/**"] }),
    "T-003": taskState({ covers: ["todo:BEH-003"], writes: ["src/api/**", "tests/api/**"], testWriterAttempts: 2 }),
  };
}

async function route(violations: readonly { readonly kind: string; readonly id?: string; readonly file?: string }[] | "recorded") {
  const root = await tempDir("assembly-route");
  const evidencePath = join(root, "run/handoffs/assembly/round-1/sdd_ready.json");
  if (violations === "recorded") {
    await writeTextAtomic(evidencePath, "");
    await copyFile(join(process.cwd(), "tests/fixtures/sdd-envelopes/ready-violations.json"), evidencePath);
  } else {
    await writeTextAtomic(evidencePath, sddReadyReport(violations));
  }
  const triaged: Effect[] = [];
  const triage: EffectHandler = async (effect) => {
    triaged.push(effect);
  };
  const context = collectingContext(runState({ status: "building", assemblyRounds: 1, tasks: tasks() }));
  await routeSddReadyEffect(triage)({ kind: "assembly.route-sdd-ready", round: 1, evidencePath }, context, sliceContext({ root }));
  return { root, evidencePath, context, triaged };
}

describe("assembly.route-sdd-ready", () => {
  // @covers assembly-stage:BEH-006
  it("routes an uncovered id to the covering task and an orphan marker to the task writing the file, both as test-writer rework", async () => {
    const { context, evidencePath, root, triaged } = await route([
      { kind: "uncovered", id: "todo:BEH-001", file: "spec/spec.md" },
      { kind: "orphan_covers", id: "todo:XXX-999", file: "tests/api/orphan.test.ts" },
    ]);

    const ledger = JSON.parse(await readFile(join(root, "run/assembly/ledger.json"), "utf8"));
    expect([context.published, triaged, ledger.reworks]).toEqual([
      [
        { type: "assembly.rework", producer: "assembler", payload: { round: 1, taskId: "T-001", target: "test-writer" } },
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "test-writer", attempt: 2, reason: "uncovered todo:BEH-001", findingPath: evidencePath } },
        { type: "assembly.rework", producer: "assembler", payload: { round: 1, taskId: "T-003", target: "test-writer" } },
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-003", target: "test-writer", attempt: 3, reason: "orphan_covers todo:XXX-999", findingPath: evidencePath } },
      ],
      [],
      [
        { round: 1, task_id: "T-001", target: "test-writer", source: "sdd_ready" },
        { round: 1, task_id: "T-003", target: "test-writer", source: "sdd_ready" },
      ],
    ]);
  });

  // @covers assembly-stage:BEH-006
  it("fails the run on an unapproved id without routing any lane", async () => {
    const { context } = await route([{ kind: "unapproved", id: "todo:DLT-001", file: "spec/spec.md" }, { kind: "uncovered", id: "todo:BEH-001", file: "spec/spec.md" }]);

    expect(context.published).toEqual([{ type: "run.failed", producer: "assembler", payload: { stage: "assembly", reason: "runtime_error", detail: "spec_gate: unapproved todo:DLT-001" } }]);
  });

  // @covers assembly-stage:BEH-006
  it("fails the run on the recorded agent-sdd envelope whose first violation is unapproved", async () => {
    const { context } = await route("recorded");

    expect(context.published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])).toEqual([["run.failed", "runtime_error", "spec_gate: unapproved factory:DLT-001"]]);
  });

  // @covers assembly-stage:BEH-006
  it("sends an aggregated lint violation to triage", async () => {
    const { context, triaged, evidencePath } = await route([{ kind: "aggregated_lint" }]);

    expect([context.published, triaged]).toEqual([[], [{ kind: "assembly.triage", round: 1, step: "sdd_ready", evidencePath }]]);
  });

  // @covers assembly-stage:DLT-003
  // @covers assembly-stage:BEH-006
  it("sends every uncovered id that no task covers to one planner re-cut and invokes no triage", async () => {
    const { context, triaged } = await route([
      { kind: "uncovered", id: "todo:SUR-002", file: "spec/spec.md" },
      { kind: "uncovered", id: "todo:SUR-001", file: "spec/spec.md" },
    ]);

    expect([context.published, triaged]).toEqual([
      [{ type: "design.rework", producer: "foreman", payload: { target: "planner", reason: "uncovered without owner: todo:SUR-001, todo:SUR-002", attempt: 1, originTaskId: null } }],
      [],
    ]);
  });

  // @covers assembly-stage:DLT-003
  // @covers assembly-stage:BEH-006
  it("routes an owned uncovered id to its test-writer and an ownerless one to the planner in the same round", async () => {
    const { context, triaged } = await route([
      { kind: "uncovered", id: "todo:BEH-001", file: "spec/spec.md" },
      { kind: "uncovered", id: "todo:SUR-001", file: "spec/spec.md" },
    ]);

    expect([context.published.map((event) => [event.type, event.payload["taskId"] ?? null, event.payload["target"]]), triaged]).toEqual([
      [
        ["assembly.rework", "T-001", "test-writer"],
        ["task.rework", "T-001", "test-writer"],
        ["design.rework", null, "planner"],
      ],
      [],
    ]);
  });

  // @covers assembly-stage:DLT-003
  // @covers assembly-stage:BEH-005
  it("still sends an aggregated lint violation to triage next to an ownerless uncovered id", async () => {
    const { context, triaged, evidencePath } = await route([{ kind: "uncovered", id: "todo:SUR-001", file: "spec/spec.md" }, { kind: "aggregated_lint" }]);

    expect([context.published.map((event) => event.type), triaged]).toEqual([["design.rework"], [{ kind: "assembly.triage", round: 1, step: "sdd_ready", evidencePath }]]);
  });
});
