import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { recordEffect } from "../../src/assembly-stage/application/record.js";
import { updateLedger } from "../../src/assembly-stage/application/ledger-store.js";
import { emptyLedger, renderReport, type AssemblyLedger } from "../../src/assembly-stage/domain/ledger.js";
import { collectingContext, RUN_ID, runState, SLUG, sliceContext, tempDir } from "./support.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function twoRoundLedger(): AssemblyLedger {
  return {
    ...emptyLedger(RUN_ID, SLUG),
    rounds: 2,
    task_order: ["T-001", "T-002"],
    merges: [
      { round: 1, task_id: "T-001", impl_sha: SHA, result: "skipped_ancestor" },
      { round: 1, task_id: "T-002", impl_sha: SHA, result: "fast_forward" },
      { round: 2, task_id: "T-001", impl_sha: SHA, result: "merged" },
    ],
    verification: [
      { round: 1, step: "install", argv: ["npm", "ci"], exit_code: 0, duration_ms: 10, result: "green", evidence_path: "/run/r1/install.log" },
      { round: 1, step: "typecheck", argv: ["npx", "tsc"], exit_code: 0, duration_ms: 10, result: "green", evidence_path: "/run/r1/typecheck.log" },
      { round: 1, step: "test", argv: ["npx", "vitest"], exit_code: 1, duration_ms: 10, result: "red", evidence_path: "/run/r1/vitest.json" },
      { round: 2, step: "install", argv: ["npm", "ci"], exit_code: 0, duration_ms: 10, result: "green", evidence_path: "/run/r2/install.log" },
      { round: 2, step: "typecheck", argv: ["npx", "tsc"], exit_code: 0, duration_ms: 10, result: "green", evidence_path: "/run/r2/typecheck.log" },
      { round: 2, step: "test", argv: ["npx", "vitest"], exit_code: 0, duration_ms: 10, result: "green", evidence_path: "/run/r2/vitest.json" },
      { round: 2, step: "sdd_ready", argv: ["npx", "sdd", "ready"], exit_code: 0, duration_ms: 10, result: "green", evidence_path: "/run/r2/sdd_ready.json" },
    ],
    sdd_ready: { ok: true, violations: [] },
    triage: [],
    reworks: [{ round: 1, task_id: "T-001", target: "implementer", source: "attribution" }],
    failing_tests: [{ round: 1, file: "tests/cli/parse.test.ts", name: "parses", message: "expected 1 to be 2\nstack" }],
  };
}

function frontmatterOf(report: string): Record<string, unknown> {
  const parsed: unknown = YAML.parse(report.split("\n---\n")[0]?.replace(/^---\n/, "") ?? "");
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("frontmatter missing");
  }
  return { ...parsed };
}

describe("assembly report contract", () => {
  // @covers assembly-stage:CTR-001
  // @covers assembly-stage:SUR-001
  it("renders the frontmatter keys of the schema with verdict published after a green second round", () => {
    const report = renderReport(twoRoundLedger(), { verdict: "published", published: { commit_sha: SHA, output_dir: "hidden/todo-cli/", pushed: true } });

    const frontmatter = frontmatterOf(report);
    expect([Object.keys(frontmatter), frontmatter["verdict"], frontmatter["rounds"], frontmatter["published"], frontmatter["reworks"]]).toEqual([
      ["run_id", "slug", "rounds", "verdict", "task_order", "merges", "verification", "sdd_ready", "triage", "reworks", "published"],
      "published",
      2,
      { commit_sha: SHA, output_dir: "hidden/todo-cli/", pushed: true },
      [{ round: 1, task_id: "T-001", target: "implementer", source: "attribution" }],
    ]);
  });

  // @covers assembly-stage:CTR-001
  it("renders verdict failed with a null published block when the run failed at the cap", () => {
    const report = renderReport({ ...twoRoundLedger(), verification: twoRoundLedger().verification.slice(0, 6) }, { verdict: "failed", detail: "cap_exhausted: round 2" });

    const frontmatter = frontmatterOf(report);
    expect([frontmatter["verdict"], frontmatter["published"], report.includes("## Failed\n\ncap_exhausted: round 2")]).toEqual(["failed", null, true]);
  });

  // @covers assembly-stage:CTR-001
  it("writes one section per round with the command summaries and the failing test names", () => {
    const report = renderReport(twoRoundLedger(), { verdict: "published", published: null });

    expect([report.includes("## Round 1\n"), report.includes("## Round 2\n"), report.includes("- test: red (exit 1, 10 ms) `npx vitest`"), report.includes("- failing test tests/cli/parse.test.ts › parses: expected 1 to be 2"), report.includes("- rework T-001 → implementer (attribution)")]).toEqual([true, true, true, true, true]);
  });

  // @covers assembly-stage:CTR-001
  it("appends triage and rework entries from the record effect and writes the failed report on failure", async () => {
    const root = await tempDir("assembly-record");
    const identity = { runDir: join(root, "run"), runId: RUN_ID, slug: SLUG };
    await updateLedger(identity, (ledger) => ({ ...ledger, rounds: 1, task_order: ["T-001"] }));
    const context = collectingContext(runState({ status: "failed", assemblyRounds: 1, tasks: {} }));

    await recordEffect()({ kind: "assembly.record", triage: [{ round: 1, task_id: null, target: "planner", reason: "unknown: empty output" }], failed: "design_blocked: unknown: empty output" }, context, sliceContext({ root }));

    const ledger = JSON.parse(await readFile(join(root, "run/assembly/ledger.json"), "utf8"));
    const frontmatter = frontmatterOf(await readFile(join(root, "product/assembly/report.md"), "utf8"));
    expect([ledger.triage, frontmatter["verdict"], frontmatter["triage"]]).toEqual([
      [{ round: 1, task_id: null, target: "planner", reason: "unknown: empty output" }],
      "failed",
      [{ round: 1, task_id: null, target: "planner", reason: "unknown: empty output" }],
    ]);
  });
});
