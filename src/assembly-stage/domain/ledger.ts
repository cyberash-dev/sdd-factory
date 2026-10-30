import YAML from "yaml";
import { ASSEMBLY_TARGETS } from "../../bus/domain/catalogue.js";
import type { AssemblyTrigger, FixOutcome } from "../../shared/fixer/index.js";
import type { AssemblyStep } from "./verification-steps.js";
import type { FailingTest } from "./vitest-report.js";

export type MergeResult = "fast_forward" | "merged" | "skipped_ancestor" | "conflict";
export type StepResult = "green" | "red";
export type ReworkTarget = "implementer" | "test-writer" | "planner";
export type ReworkSource = "attribution" | "triage" | "sdd_ready";
export type Verdict = "published" | "failed";

export function isReworkTarget(value: unknown): value is ReworkTarget {
  return typeof value === "string" && (ASSEMBLY_TARGETS as readonly string[]).includes(value);
}

export interface MergeEntry {
  readonly round: number;
  readonly task_id: string;
  readonly impl_sha: string;
  readonly result: MergeResult;
}

export interface VerificationEntry {
  readonly round: number;
  readonly step: AssemblyStep;
  readonly argv: readonly string[];
  readonly exit_code: number;
  readonly duration_ms: number;
  readonly result: StepResult;
  readonly evidence_path: string;
}

export interface SddReadyEntry {
  readonly ok: boolean;
  readonly violations: readonly { readonly kind: string; readonly id: string; readonly file: string }[];
}

export interface TriageEntry {
  readonly round: number;
  readonly task_id: string | null;
  readonly target: ReworkTarget;
  readonly reason: string;
}

export interface ReworkEntry {
  readonly round: number;
  readonly task_id: string;
  readonly target: ReworkTarget;
  readonly source: ReworkSource;
}

export interface FixEntry {
  readonly round: number;
  readonly attempt: number;
  readonly trigger: AssemblyTrigger;
  readonly outcome: FixOutcome;
  readonly commit_sha: string | null;
  readonly files: readonly string[];
}

export interface PublishedEntry {
  readonly commit_sha: string | null;
  readonly output_dir: string;
  readonly pushed: boolean;
}

export interface RoundFailingTest extends FailingTest {
  readonly round: number;
}

export interface AssemblyLedger {
  readonly run_id: string;
  readonly slug: string;
  readonly rounds: number;
  readonly task_order: readonly string[];
  readonly merges: readonly MergeEntry[];
  readonly verification: readonly VerificationEntry[];
  readonly sdd_ready: SddReadyEntry;
  readonly triage: readonly TriageEntry[];
  readonly reworks: readonly ReworkEntry[];
  readonly fixes: readonly FixEntry[];
  readonly verified_head: string | null;
  readonly failing_tests: readonly RoundFailingTest[];
}

export type ReportOutcome =
  | { readonly verdict: "published"; readonly published: PublishedEntry | null }
  | { readonly verdict: "failed"; readonly detail: string };

export function emptyLedger(runId: string, slug: string): AssemblyLedger {
  return { run_id: runId, slug, rounds: 0, task_order: [], merges: [], verification: [], sdd_ready: { ok: false, violations: [] }, triage: [], reworks: [], fixes: [], verified_head: null, failing_tests: [] };
}

export function isLedger(value: unknown): value is AssemblyLedger {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record["run_id"] === "string" &&
    typeof record["slug"] === "string" &&
    typeof record["rounds"] === "number" &&
    Array.isArray(record["task_order"]) &&
    Array.isArray(record["merges"]) &&
    Array.isArray(record["verification"]) &&
    Array.isArray(record["triage"]) &&
    Array.isArray(record["reworks"]) &&
    Array.isArray(record["fixes"]) &&
    Array.isArray(record["failing_tests"])
  );
}

function roundSection(ledger: AssemblyLedger, round: number): string {
  const merges = ledger.merges.filter((entry) => entry.round === round).map((entry) => `- merge ${entry.task_id} ${entry.impl_sha.slice(0, 12)}: ${entry.result}`);
  const verification = ledger.verification
    .filter((entry) => entry.round === round)
    .map((entry) => `- ${entry.step}: ${entry.result} (exit ${entry.exit_code}, ${entry.duration_ms} ms) \`${entry.argv.join(" ")}\``);
  const failingTests = ledger.failing_tests.filter((entry) => entry.round === round).map((entry) => `- failing test ${entry.file} › ${entry.name}: ${entry.message.split("\n")[0] ?? ""}`);
  const triage = ledger.triage.filter((entry) => entry.round === round).map((entry) => `- triage ${entry.task_id ?? "(no task)"} → ${entry.target}: ${entry.reason}`);
  const reworks = ledger.reworks.filter((entry) => entry.round === round).map((entry) => `- rework ${entry.task_id} → ${entry.target} (${entry.source})`);
  const fixes = ledger.fixes.filter((entry) => entry.round === round).map((entry) => `- fix ${entry.attempt} ${entry.trigger}: ${entry.outcome} (${entry.files.join(", ")})`);
  return [`## Round ${round}`, "", ...merges, ...verification, ...fixes, ...failingTests, ...triage, ...reworks, ""].join("\n");
}

function outcomeSection(outcome: ReportOutcome): string {
  if (outcome.verdict === "failed") {
    return ["## Failed", "", outcome.detail, ""].join("\n");
  }
  const published = outcome.published;
  const line = published === null ? "publication pending" : `commit ${published.commit_sha ?? "(none)"} → ${published.output_dir} (${published.pushed ? "pushed" : "not pushed"})`;
  return ["## Published", "", line, ""].join("\n");
}

export function renderReport(ledger: AssemblyLedger, outcome: ReportOutcome): string {
  const frontmatter = {
    run_id: ledger.run_id,
    slug: ledger.slug,
    rounds: ledger.rounds,
    verdict: outcome.verdict,
    task_order: [...ledger.task_order],
    merges: ledger.merges.map((entry) => ({ ...entry })),
    verification: ledger.verification.map((entry) => ({ ...entry, argv: [...entry.argv] })),
    sdd_ready: { ok: ledger.sdd_ready.ok, violations: ledger.sdd_ready.violations.map((entry) => ({ ...entry })) },
    triage: ledger.triage.map((entry) => ({ ...entry })),
    reworks: ledger.reworks.map((entry) => ({ ...entry })),
    fixes: ledger.fixes.map((entry) => ({ ...entry, files: [...entry.files] })),
    published: outcome.verdict === "published" ? outcome.published : null,
  };
  const rounds = Array.from({ length: ledger.rounds }, (_, index) => roundSection(ledger, index + 1));
  return ["---", YAML.stringify(frontmatter).trimEnd(), "---", "", `# Assembly report ${ledger.slug} ${ledger.run_id}`, "", ...rounds, outcomeSection(outcome)].join("\n");
}
