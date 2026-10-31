import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { readTextOrNull } from "../../src/shared/fs/text.js";
import { runApprove } from "../../src/spec-stage/application/approve.js";
import { createStageClock, type StageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { CommandResult, CommandRunner } from "../../src/spec-stage/ports/command-runner.js";
import { CLI_SPEC, effectContext, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace } from "./harness.js";

const FINALIZED: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo-cli:SUR-001"],"files_changed":["spec/spec.md"],"archived_path":"x"}\n', stderr: "" };

const LINT_NAMING_IB_001 =
  '{"format_version":1,"ok":false,"error_count":1,"warn_count":0,"diagnostics":[{"severity":"error","rule":"sdd:boundary-policy-ref","file":"spec/spec.md","line":30,"message":"Boundary ImplementationBinding \\"todo-cli:IB-001\\" must declare policy_refs"}]}';

function reviewedState(specGateReworks: number): RunState {
  return runStateAt("spec_review", { stageAttempts: { lintCycles: 0, criticRounds: 1, plannerRecuts: 0, architectRepairs: 0, assemblyRounds: 0, specGateReworks } });
}

interface DirectoryCommands extends CommandRunner {
  readonly productCalls: string[][];
}

function commandsByDirectory(productDir: string, inProduct: (argv: readonly string[]) => CommandResult, inScratch: (argv: readonly string[]) => CommandResult): DirectoryCommands {
  const productCalls: string[][] = [];
  return {
    productCalls,
    async run(argv, cwd) {
      const isProduct = cwd === productDir;
      productCalls.push(...(isProduct ? [[...argv]] : []));
      return isProduct ? inProduct(argv) : inScratch(argv);
    },
  };
}

function stopCountingClock(stops: { count: number }): StageClock {
  return { start: () => undefined, stop: () => (stops.count += 1) };
}

describe("approval gate failure goes back to the analyst", () => {
  // @covers spec-stage:DLT-011
  it("publishes spec.gate_failed with the lint failure instead of spec.blocked when lint fails at the gate", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: LINT_NAMING_IB_001, stderr: "" } }));
    const { context, published } = effectContext(reviewedState(0));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect(published).toEqual([{ type: "spec.gate_failed", producer: "foreman", payload: { findingsPath: "spec/review/gate.md", detail: `lint_failed: ${LINT_NAMING_IB_001}` } }]);
  });

  // @covers spec-stage:DLT-011
  it("writes gate.md with one GATE-001 finding targeting the record the failed lint names", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const commands = scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: LINT_NAMING_IB_001, stderr: "" } }));
    const { context } = effectContext(reviewedState(0));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const gate = (await readTextOrNull(join(ws.productDir, "spec", "review", "gate.md"))) ?? "";
    expect(gate.match(/^- id: GATE-[0-9]{3}\n {2}kind: \w+\n {2}target_ids: .*$/gm)).toEqual(['- id: GATE-001\n  kind: gap\n  target_ids: ["todo-cli:IB-001"]']);
  });

  // @covers spec-stage:DLT-011
  it("writes an integrity failure without a record id as a conflict finding without targets", async () => {
    const secondSurface = CLI_SPEC.slice(CLI_SPEC.indexOf("```yaml"), CLI_SPEC.indexOf("## 7.")).replace("todo-cli:SUR-001", "todo-cli:SUR-002");
    const ws = await stageWorkspace(CLI_SPEC.replace("## 7. Data contracts", `${secondSurface}\n## 7. Data contracts`));
    const { context, published } = effectContext(reviewedState(0));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands: scriptedCommands(sddReplies({})), clock: createStageClock() });

    const gate = (await readTextOrNull(join(ws.productDir, "spec", "review", "gate.md"))) ?? "";
    expect([published.map((event) => event.type), gate.includes('  kind: conflict\n  target_ids: []\n  source: none\n  resolution: decide\n  required_change: "spec_integrity: expected exactly one Surface, found 2"')]).toEqual([["spec.gate_failed"], true]);
  });

  // @covers spec-stage:DLT-011
  it("removes the queued approval plan before reporting a refused finalize", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const plansDir = join(ws.productDir, ".sdd", "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, ".active"), "2026-10-31T101500Z-abcde\n", "utf8");
    await writeFile(join(plansDir, "2026-10-31T101500Z-abcde.yaml"), "plan_id: 2026-10-31T101500Z-abcde\n", "utf8");
    const refused: CommandResult = { exitCode: 1, stdout: '{"format_version":1,"ok":false,"reason":"proposed-references"}', stderr: "" };
    const commands = commandsByDirectory(ws.productDir, sddReplies({ finalize: refused }), sddReplies({ finalize: FINALIZED }));
    const { context, published } = effectContext(reviewedState(0));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    expect([published, await readdir(plansDir)]).toEqual([
      [{ type: "spec.gate_failed", producer: "foreman", payload: { findingsPath: "spec/review/gate.md", detail: 'finalize_failed: {"format_version":1,"ok":false,"reason":"proposed-references"}' } }],
      [],
    ]);
  });

  // @covers spec-stage:DLT-010
  // @covers spec-stage:DLT-011
  it("reports a probe violation to the analyst before approving anything in the product directory", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const drift: CommandResult = {
      exitCode: 1,
      stdout: '{"format_version":1,"ok":false,"violations":[{"kind":"surface_member_drift","id":"todo-cli:SUR-001","remediation":"add record todo-cli:CTR-001 to members"},{"kind":"uncovered","id":"todo-cli:CTR-001","remediation":"add a test"}]}',
      stderr: "",
    };
    const commands = commandsByDirectory(ws.productDir, sddReplies({ finalize: FINALIZED }), sddReplies({ finalize: FINALIZED, ready: drift }));
    const { context, published } = effectContext(reviewedState(0));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const gate = (await readTextOrNull(join(ws.productDir, "spec", "review", "gate.md"))) ?? "";
    expect([
      commands.productCalls.map((argv) => argv[0]),
      published,
      gate.includes('  target_ids: ["todo-cli:CTR-001"]\n  source: none\n  resolution: decide\n  required_change: "surface_member_drift: add record todo-cli:CTR-001 to members"'),
    ]).toEqual([["lint"], [{ type: "spec.gate_failed", producer: "foreman", payload: { findingsPath: "spec/review/gate.md", detail: "approval_probe: surface_member_drift: add record todo-cli:CTR-001 to members" } }], true]);
  });

  // @covers spec-stage:DLT-011
  it("keeps the spec stage clock running when the gate failure goes back to the analyst", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const stops = { count: 0 };
    const { context } = effectContext(reviewedState(0));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands: scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: LINT_NAMING_IB_001, stderr: "" } })), clock: stopCountingClock(stops) });

    expect(stops.count).toBe(0);
  });

  // @covers spec-stage:DLT-011
  it("stops the spec stage clock when the gate failure reaches the gate rework cap", async () => {
    const ws = await stageWorkspace(CLI_SPEC);
    const stops = { count: 0 };
    const { context } = effectContext(reviewedState(1));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands: scriptedCommands(sddReplies({ lint: { exitCode: 1, stdout: LINT_NAMING_IB_001, stderr: "" } })), clock: stopCountingClock(stops) });

    expect(stops.count).toBe(1);
  });
});
