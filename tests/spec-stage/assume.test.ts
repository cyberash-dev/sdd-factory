import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTaskState } from "../../src/bus/domain/run-state.js";
import { runAssume } from "../../src/spec-stage/application/assume.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import { CLI_SPEC, criticHandoff, effectContext, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type StageWorkspace } from "./harness.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const ASSUMPTION_RECORD = "```yaml\n---\nid: todo-cli:ASM-002\ntype: ASSUMPTION\nlifecycle: {status: proposed}\npartition_id: todo-cli\nassumption: list prints items oldest first\nsource_open_q: null\nblocking: no\nreview_by: \"2026-10-29\"\n---\n```\n";

const EMPTY_ASSUMPTIONS = "## 1. Context\nnone\n\n## 18. Assumptions\n";

const handoffPath = (ws: StageWorkspace): string => join(ws.handoffsDir, "tasks", "T-001", "spec-critic-1", "handoff.md");

function buildingState(assumptionsByRecord: Readonly<Record<string, number>>) {
  const task = createTaskState({ worktree: "/wt/T-001", covers: ["todo-cli:BEH-003"], writes: ["src/list.ts"], dependsOn: [] });
  return runStateAt("building", {
    assumptionsByRecord,
    tasks: { "T-001": { ...task, status: "tests_pending", baseSha: SHA, attempts: { implementer: 1, testWriter: 1 } }, "T-002": { ...task, covers: ["todo-cli:BEH-003", "todo-cli:CTR-001"] } },
  });
}

const assumeEffect = { kind: "spec.assume", specIds: ["todo-cli:BEH-003"], finding: "the test expects newest first, the implementation prints oldest first", taskIds: ["T-001", "T-002"] };

describe("spec.assume effect", () => {
  // @covers spec-stage:BEH-004
  // @covers spec-stage:CTR-002
  it("appends one assumption, leaves spec.md untouched, lints, and reworks the test-writer of every affected task", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    await writeText(ws.assumptionsPath, EMPTY_ASSUMPTIONS);
    const roles = scriptedRoles([
      async () => {
        await writeFile(ws.assumptionsPath, EMPTY_ASSUMPTIONS + ASSUMPTION_RECORD, "utf8");
        await writeText(handoffPath(ws), criticHandoff(1, "accept", { assumptions_added: ["todo-cli:ASM-002"] }));
      },
    ]);
    const commands = scriptedCommands(sddReplies({}));
    const { context, published } = effectContext(buildingState({ "todo-cli:BEH-003": 1 }));

    await runAssume(assumeEffect, context, sliceContext(ws, roles), { commands, clock: createStageClock() });

    expect([await readFile(ws.specPath, "utf8"), commands.calls, published]).toEqual([
      CLI_SPEC,
      [["lint", "--format=json"]],
      [
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-001", target: "test-writer", attempt: 2, reason: "assumption todo-cli:ASM-002 decided todo-cli:BEH-003", findingPath: "spec/assumptions.md" } },
        { type: "task.rework", producer: "foreman", payload: { taskId: "T-002", target: "test-writer", attempt: 1, reason: "assumption todo-cli:ASM-002 decided todo-cli:BEH-003", findingPath: "spec/assumptions.md" } },
      ],
    ]);
  });

  // @covers spec-stage:BEH-004
  it("tells the critic the record ids, the finding, the review date and the assumptions file, with the critic model", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeText(ws.assumptionsPath, EMPTY_ASSUMPTIONS + ASSUMPTION_RECORD);
        await writeText(handoffPath(ws), criticHandoff(1, "accept", { assumptions_added: ["todo-cli:ASM-002"] }));
      },
    ]);
    const { context } = effectContext(buildingState({ "todo-cli:BEH-003": 1 }));

    await runAssume(assumeEffect, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    const message = roles.requests[0]?.message ?? "";
    expect([roles.requests[0]?.model, message.includes("can no longer change: todo-cli:BEH-003"), message.includes("the test expects newest first"), message.includes("review_by 2026-10-29"), message.includes(`${ws.productDir}/spec/assumptions.md`), message.includes("{{")]).toEqual([
      "claude-haiku-4-5",
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  // @covers spec-stage:CST-003
  // @covers spec-stage:BEH-004
  it("fails the first task with cap_exhausted instead of a second assumption on the same record id", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([]);
    const { context, published } = effectContext(buildingState({ "todo-cli:BEH-003": 2 }));

    await runAssume(assumeEffect, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([roles.requests.length, published]).toEqual([0, [{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "cap_exhausted", detail: "critic assumption cap" } }]]);
  });

  // @covers spec-stage:BEH-004
  it("fails the task when the critic modified spec/spec.md in assumption mode", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeFile(ws.specPath, `${CLI_SPEC}\nedited\n`, "utf8");
        await writeText(ws.assumptionsPath, EMPTY_ASSUMPTIONS + ASSUMPTION_RECORD);
        await writeText(handoffPath(ws), criticHandoff(1, "accept", { assumptions_added: ["todo-cli:ASM-002"] }));
      },
    ]);
    const { context, published } = effectContext(buildingState({}));

    await runAssume(assumeEffect, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect(published).toEqual([{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "blocked", detail: "critic_wrote_spec: spec/spec.md changed in assumption mode" } }]);
  });

  // @covers spec-stage:CTR-002
  it("re-runs the critic when assumptions.md did not gain exactly one record, then fails the task", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      () => writeText(handoffPath(ws), criticHandoff(1, "accept", { assumptions_added: ["todo-cli:ASM-002"] })),
      async () => {
        await writeText(ws.assumptionsPath, EMPTY_ASSUMPTIONS + ASSUMPTION_RECORD + ASSUMPTION_RECORD.replace("ASM-002", "ASM-003"));
        await writeText(handoffPath(ws), criticHandoff(1, "accept", { assumptions_added: ["todo-cli:ASM-002", "todo-cli:ASM-003"] }));
      },
    ]);
    const { context, published } = effectContext(buildingState({}));

    await runAssume(assumeEffect, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([roles.requests[1]?.message.includes("rejected: spec/assumptions.md must gain exactly one ASSUMPTION record, it gained 0"), published]).toEqual([
      true,
      [{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "unparseable_handoff", detail: "spec/assumptions.md must gain exactly one ASSUMPTION record, it gained 2" } }],
    ]);
  });

  // @covers spec-stage:CTR-002
  it("fails the task when lint rejects the assumptions file", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const roles = scriptedRoles([
      async () => {
        await writeText(ws.assumptionsPath, EMPTY_ASSUMPTIONS + ASSUMPTION_RECORD.replace("status: proposed", "status: approved"));
        await writeText(handoffPath(ws), criticHandoff(1, "accept", { assumptions_added: ["todo-cli:ASM-002"] }));
      },
    ]);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: "", stderr: "sdd:approval-record-required" } }));
    const { context, published } = effectContext(buildingState({}));

    await runAssume(assumeEffect, context, sliceContext(ws, roles), { commands, clock: createStageClock() });

    expect(published).toEqual([{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "blocked", detail: "assumptions_file_invalid: sdd:approval-record-required" } }]);
  });

  it("refuses critic writes outside spec/assumptions.md and its handoff directory", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const replies: unknown[] = [];
    const roles = scriptedRoles([
      async (request) => {
        const write = request.tools.find((tool) => tool.name === "write_file");
        replies.push(await write?.invoke({ path: "spec/review/ga.md", content: "x" }), await write?.invoke({ path: "spec/assumptions.md", content: EMPTY_ASSUMPTIONS + ASSUMPTION_RECORD }));
        await writeText(handoffPath(ws), criticHandoff(1, "accept", { assumptions_added: ["todo-cli:ASM-002"] }));
      },
    ]);
    const { context, published } = effectContext(buildingState({}));

    await runAssume(assumeEffect, context, sliceContext(ws, roles), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    expect([replies[0], published.map((event) => event.type)]).toEqual(["ERROR: path spec/review/ga.md is outside what this role is allowed to write", ["task.rework", "task.rework"]]);
  });
});
