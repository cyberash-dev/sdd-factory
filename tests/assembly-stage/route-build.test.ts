import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeBuildEffect } from "../../src/assembly-stage/application/route-build.js";
import type { TaskState } from "../../src/bus/domain/run-state.js";
import type { Effect } from "../../src/bus/domain/transition.js";
import { readTextOrNull, writeTextAtomic } from "../../src/shared/fs/text.js";
import type { EffectHandler } from "../../src/shared/slice.js";
import { collectingContext, runState, sliceContext, taskState, tempDir } from "./support.js";

async function route(tasks: Readonly<Record<string, TaskState>>, evidenceFile: string, evidence: string) {
  const root = await tempDir("assembly-route-build");
  const evidencePath = join(root, "run/handoffs/assembly/round-1", evidenceFile);
  await writeTextAtomic(evidencePath, evidence);
  const triaged: Effect[] = [];
  const triage: EffectHandler = async (effect) => {
    triaged.push(effect);
  };
  const context = collectingContext(runState({ status: "building", assemblyRounds: 1, tasks }));
  await routeBuildEffect(triage)({ kind: "assembly.route-build", round: 1, evidencePath }, context, sliceContext({ root }));
  return { root, evidencePath, context, triaged };
}

describe("assembly.route-build", () => {
  // @covers assembly-stage:DLT-006
  it("routes missing named scripts as implementer rework to the task whose writes contain package.json", async () => {
    const { context, evidencePath, triaged } = await route(
      { "T-001": taskState({ writes: ["package.json", "src/index.ts"], implementerAttempts: 1 }), "T-002": taskState({ writes: ["src/store/**"] }) },
      "npm_scripts.json",
      '{"named":["build","start"],"missing":["start"]}\n',
    );

    expect([context.published, triaged]).toEqual([
      [
        { type: "assembly.rework", producer: "assembler", payload: { round: 1, taskId: "T-001", target: "implementer" } },
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "implementer", attempt: 2, reason: "missing npm scripts named by the spec: start", findingPath: evidencePath } },
      ],
      [],
    ]);
  });

  // @covers assembly-stage:DLT-006
  // @covers assembly-stage:CTR-001
  it("records the routed missing-scripts rework in the ledger with source attribution", async () => {
    const { root } = await route({ "T-001": taskState({ writes: ["package.json"] }) }, "npm_scripts.json", '{"named":["start"],"missing":["start"]}\n');

    const ledger = JSON.parse((await readTextOrNull(join(root, "run/assembly/ledger.json"))) ?? "{}");
    expect(ledger.reworks).toEqual([{ round: 1, task_id: "T-001", target: "implementer", source: "attribution" }]);
  });

  // @covers assembly-stage:DLT-006
  it("sends missing named scripts to triage when no task writes package.json", async () => {
    const { context, evidencePath, triaged } = await route({ "T-001": taskState({ writes: ["src/**"] }) }, "npm_scripts.json", '{"named":["start"],"missing":["start"]}\n');

    expect([context.published, triaged]).toEqual([[], [{ kind: "assembly.triage", round: 1, step: "build", evidencePath }]]);
  });

  // @covers assembly-stage:DLT-005
  it("sends a failed npm run build to triage even when a task writes package.json", async () => {
    const { context, evidencePath, triaged } = await route({ "T-001": taskState({ writes: ["package.json"] }) }, "build.log", "--- stdout ---\nsrc/index.ts(3,7): error TS2322\n--- stderr ---\n\n");

    expect([context.published, triaged]).toEqual([[], [{ kind: "assembly.triage", round: 1, step: "build", evidencePath }]]);
  });
});
