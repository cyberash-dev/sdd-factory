import { execFile } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runApprove } from "../../src/spec-stage/application/approve.js";
import { listedRecords } from "../../src/spec-stage/application/listed-records.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { CommandResult, CommandRunner } from "../../src/spec-stage/ports/command-runner.js";
import { effectContext, runStateAt, scriptedRoles, sliceContext, stageWorkspace, writeText } from "./harness.js";

const SDD_BIN = join(process.cwd(), "node_modules", ".bin", "sdd");

const SDD_CONFIG = {
  spec_file: "spec/spec.md",
  baseline_id: "todo-cli:BL-001",
  discovery_scope: ["src"],
  mechanism: "git_tree_hash_v1",
  lint: { spec_files: ["spec/spec.md", "spec/assumptions.md"], approver_blocklist: [] },
  partitions: { "todo-cli": { spec_paths: ["spec/spec.md", "spec/assumptions.md"], test_paths: ["tests/**/*.test.ts"], sandbox_paths: ["spec/assumptions.md"] } },
};

const SPEC = `# todo-cli product specification

## 5. Surfaces

\`\`\`yaml
---
id: todo-cli:SUR-001
type: Surface
lifecycle: {status: proposed}
partition_id: todo-cli
name: todo
boundary_type: cli
members: [todo-cli:CTR-001]
version: "0.1.0"
---
\`\`\`

## 7. Data contracts

\`\`\`yaml
---
id: todo-cli:CTR-001
type: Contract
lifecycle: {status: proposed}
partition_id: todo-cli
title: todo add
surface_ref: todo-cli:SUR-001
policy_refs: {not_applicable: local cli}
applicability: {invariant_to_all_axes: true}
concurrency_model: {not_applicable: single process}
data_scope: {not_applicable: no persistent state}
test_obligation: {predicate: the todo is stored, test_template: unit}
---
\`\`\`
`;

const ASSUMPTIONS = `# todo-cli assumptions (sandbox)

## 18. Assumptions

\`\`\`yaml
---
id: todo-cli:ASM-002
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: todo-cli
assumption: blank text is rejected with exit 2
source_open_q: null
blocking: no
review_by: "2026-11-30"
---
\`\`\`
`;

function realSdd(): CommandRunner {
  return {
    run: (argv, cwd) =>
      new Promise<CommandResult>((resolve) => {
        execFile(SDD_BIN, [...argv], { cwd }, (error, stdout, stderr) => resolve({ exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1, stdout, stderr }));
      }),
  };
}

describe("pre-authorised approval against the real sdd CLI", () => {
  // @covers spec-stage:DLT-013
  it("approves the proposed records of spec.md although spec/assumptions.md, read first, holds a proposed ASSUMPTION", async () => {
    const ws = await stageWorkspace(SPEC);
    await writeText(join(ws.productDir, ".sdd", "config.json"), JSON.stringify(SDD_CONFIG));
    await writeText(ws.assumptionsPath, ASSUMPTIONS);
    const commands = realSdd();
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, sliceContext(ws, scriptedRoles([])), { commands, clock: createStageClock() });

    const records = await listedRecords(commands, ws.productDir);
    expect([published.map((event) => event.type), records.map((record) => [record.id, record.status])]).toEqual([
      ["spec.approved"],
      [
        ["todo-cli:ASM-002", "approved"],
        ["todo-cli:SUR-001", "approved"],
        ["todo-cli:CTR-001", "approved"],
      ],
    ]);
  }, 60_000);
});
