import { access, appendFile, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { readTextOrNull } from "../../src/shared/fs/text.js";
import { probeApproval } from "../../src/spec-stage/application/approval-probe.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { CommandResult, CommandRunner } from "../../src/spec-stage/ports/command-runner.js";
import { CLI_SPEC, exitZero, scriptedRoles, sliceContext, stageWorkspace, writeText, type StageWorkspace } from "./harness.js";

interface RecordedCall {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly specText: string | null;
}

interface RecordingCommands extends CommandRunner {
  readonly calls: RecordedCall[];
}

const FLIPPED_MARK = "# flipped by finalize\n";

/* Like the real CLI, finalize rewrites the spec of the directory it runs in. */
function recordingCommands(replies: Readonly<Record<string, CommandResult>>): RecordingCommands {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(argv, cwd) {
      const specPath = join(cwd, "spec", "spec.md");
      calls.push({ argv: [...argv], cwd, specText: await readTextOrNull(specPath) });
      const reply = replies[argv[0] ?? ""] ?? exitZero();
      if (argv[0] === "finalize" && reply.exitCode === 0) {
        await appendFile(specPath, FLIPPED_MARK, "utf8");
      }
      return reply;
    },
  };
}

async function probeWorkspace(): Promise<StageWorkspace> {
  const workspace = await stageWorkspace(CLI_SPEC);
  await writeText(join(workspace.productDir, ".sdd", "config.json"), '{"spec_file":"spec/spec.md"}\n');
  return workspace;
}

function readyResult(exitCode: number, violations: readonly Readonly<Record<string, unknown>>[]): CommandResult {
  return { exitCode, stdout: `${JSON.stringify({ ok: violations.length === 0, error: null, violations, advisories: [] })}\n`, stderr: "" };
}

function uncovered(id: string): Readonly<Record<string, unknown>> {
  return { kind: "uncovered", id, partition: "todo", status: "approved", file: "spec/spec.md", line: 40, remediation: `add \`@covers ${id}\` next to a test for this ID, or set \`Test obligation: not_applicable + reason\`` };
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

const FINALIZED: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo:SUR-001","todo:BEH-003"]}\n', stderr: "" };

const APPROVALS: readonly (readonly string[])[] = [
  ["approve", "--id", "todo:*", "--approver", "cyberash", "--format=json"],
  ["approve", "--id", "todo:BL-001", "--approver", "cyberash", "--format=json"],
];

const MEMBER_DRIFT = {
  kind: "surface_member_drift",
  id: "todo:SUR-001",
  partition: "todo",
  status: "approved",
  file: "spec/spec.md",
  line: 12,
  remediation: "record todo:BEH-003 declares surface_ref todo:SUR-001 but is absent from its members; finalise the Delta that adds it",
};

describe("approval probe on a scratch copy of the product", () => {
  // @covers spec-stage:DLT-010
  it("returns the structural violation sdd ready reports and drops the uncovered ones", async () => {
    const ws = await probeWorkspace();
    const commands = recordingCommands({ finalize: FINALIZED, ready: readyResult(1, [MEMBER_DRIFT, uncovered("todo:BEH-001"), uncovered("todo:BEH-002")]) });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect(findings).toEqual([
      { kind: "surface_member_drift", recordId: "todo:BEH-003", message: "record todo:BEH-003 declares surface_ref todo:SUR-001 but is absent from its members; finalise the Delta that adds it" },
    ]);
  });

  // @covers spec-stage:DLT-010
  it("names the proposed member of a surface_unapproved_ref violation", async () => {
    const ws = await probeWorkspace();
    const unapprovedMember = { ...MEMBER_DRIFT, kind: "surface_unapproved_ref", remediation: "member todo:CTR-001 is proposed; approve it before approving Surface todo:SUR-001" };
    const commands = recordingCommands({ finalize: FINALIZED, ready: readyResult(1, [unapprovedMember]) });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect(findings).toEqual([{ kind: "surface_unapproved_ref", recordId: "todo:CTR-001", message: "member todo:CTR-001 is proposed; approve it before approving Surface todo:SUR-001" }]);
  });

  // @covers spec-stage:DLT-010
  it("keeps an aggregated_lint violation the scratch finalize surfaced", async () => {
    const ws = await probeWorkspace();
    const lintError = { kind: "aggregated_lint", file: "spec/spec.md", line: 52, remediation: "weasel word `should` in normative field then", source: "sdd:weasel-word" };
    const commands = recordingCommands({ finalize: FINALIZED, ready: readyResult(1, [lintError, uncovered("todo:BEH-001")]) });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect(findings).toEqual([{ kind: "aggregated_lint", recordId: null, message: "weasel word `should` in normative field then" }]);
  });

  // @covers spec-stage:DLT-010
  it("names the record of the violation itself when the remediation names no record", async () => {
    const ws = await probeWorkspace();
    const unappliedImpact = { ...MEMBER_DRIFT, remediation: "Delta todo:DLT-001 declares surface_impact todo:SUR-001@0.2.0 but the surface is at 0.1.0; finalise the Delta to apply the bump" };
    const commands = recordingCommands({ finalize: FINALIZED, ready: readyResult(1, [unappliedImpact]) });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect(findings).toEqual([
      { kind: "surface_member_drift", recordId: "todo:SUR-001", message: "Delta todo:DLT-001 declares surface_impact todo:SUR-001@0.2.0 but the surface is at 0.1.0; finalise the Delta to apply the bump" },
    ]);
  });

  // @covers spec-stage:DLT-010
  it("runs every approve, finalize and ready in one copy of the product under the run directory, never in the product directory", async () => {
    const ws = await probeWorkspace();
    const commands = recordingCommands({ finalize: FINALIZED, ready: readyResult(0, []) });

    await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    const scratchDir = commands.calls[0]?.cwd ?? "";
    expect(commands.calls.map((call) => [call.argv[0], call.cwd === scratchDir, call.cwd === ws.productDir, call.cwd.startsWith(`${ws.runDir}${sep}`), call.specText])).toEqual([
      ["approve", true, false, true, CLI_SPEC],
      ["approve", true, false, true, CLI_SPEC],
      ["finalize", true, false, true, CLI_SPEC],
      ["ready", true, false, true, `${CLI_SPEC}${FLIPPED_MARK}`],
    ]);
  });

  // @covers spec-stage:DLT-010
  it("leaves the product spec byte-identical and removes the scratch directory afterwards", async () => {
    const ws = await probeWorkspace();
    const commands = recordingCommands({ finalize: FINALIZED, ready: readyResult(1, [MEMBER_DRIFT]) });

    await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect([await readFile(ws.specPath, "utf8"), await Promise.all(commands.calls.map((call) => pathExists(call.cwd)))]).toEqual([CLI_SPEC, [false, false, false, false]]);
  });

  // @covers spec-stage:DLT-010
  it("returns one finalize_failed finding with the finalize output and never runs sdd ready when the probe finalize fails", async () => {
    const ws = await probeWorkspace();
    const commands = recordingCommands({ finalize: { exitCode: 1, stdout: '{"format_version":1,"ok":false,"reason":"proposed-references"}', stderr: "" } });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect([findings, commands.calls.map((call) => call.argv[0])]).toEqual([
      [{ kind: "finalize_failed", recordId: null, message: '{"format_version":1,"ok":false,"reason":"proposed-references"}' }],
      ["approve", "approve", "finalize"],
    ]);
  });

  // @covers spec-stage:DLT-010
  it("returns one approve_failed finding and stops when a probe approve fails", async () => {
    const ws = await probeWorkspace();
    const commands = recordingCommands({ approve: { exitCode: 1, stdout: '{"format_version":1,"ok":false,"reason":"agent-approver"}', stderr: "" } });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect([findings, commands.calls.map((call) => call.argv[0])]).toEqual([[{ kind: "approve_failed", recordId: null, message: '{"format_version":1,"ok":false,"reason":"agent-approver"}' }], ["approve"]]);
  });

  // @covers spec-stage:DLT-010
  it("tolerates an approve that matched no id, as the real baseline approval does", async () => {
    const ws = await probeWorkspace();
    const commands = recordingCommands({ approve: { exitCode: 1, stdout: '{"format_version":1,"ok":false,"reason":"no-id-match"}', stderr: "" }, finalize: FINALIZED, ready: readyResult(0, []) });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect([findings, commands.calls.map((call) => call.argv[0])]).toEqual([[], ["approve", "approve", "finalize", "ready"]]);
  });

  // @covers spec-stage:DLT-010
  it("returns no finding when sdd ready reports only violations that depend on tests or git state", async () => {
    const ws = await probeWorkspace();
    const testDependent = [
      uncovered("todo:BEH-001"),
      { kind: "orphan_covers", id: "todo:BEH-999", file: "tests/orphan.test.ts", remediation: "remove the marker" },
      { kind: "unapproved", id: "todo:ASM-001", partition: "todo", status: "proposed", file: "spec/spec.md", line: 70, remediation: "promote via `sdd approve` or move into sandbox_paths" },
      { kind: "aggregated_check", remediation: "baseline-dirty: 2 uncommitted path(s) inside discovery_scope", file: "src/" },
      { kind: "debt_budget_increased", id: "todo", remediation: "unmodeled budget grew" },
    ];
    const commands = recordingCommands({ finalize: FINALIZED, ready: readyResult(1, testDependent) });

    const findings = await probeApproval(sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() }, APPROVALS);

    expect(findings).toEqual([]);
  });
});
