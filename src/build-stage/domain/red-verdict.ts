import type { TESTS_REJECTED_REASONS } from "../../bus/domain/catalogue.js";
import { coversEvidence, type CoversEvidence } from "./verifier-evidence.js";
import type { TestEntry, VitestSummary } from "./vitest-report.js";
import { isUnderTests, matchesWriteSet } from "./write-set.js";

export type TestsRejectedReason = (typeof TESTS_REJECTED_REASONS)[number];

export interface RedInput {
  readonly timedOut: boolean;
  readonly typecheckExitCode: number;
  readonly typecheckOutput: string;
  readonly report: VitestSummary | null;
  readonly changedFiles: readonly string[];
  readonly writes: readonly string[];
  readonly covers: readonly string[];
  readonly coversFound: readonly string[];
  readonly firewallViolations: readonly string[];
}

export interface RedRejection {
  readonly reason: TestsRejectedReason;
  readonly detail: string;
}

interface RedJudgement {
  readonly reasons: readonly string[];
  readonly covers: CoversEvidence;
  readonly writeSetOk: boolean;
  readonly testFiles: readonly string[];
}

export type RedVerdict =
  | (RedJudgement & { readonly verdict: "pass"; readonly rejection: null })
  | (RedJudgement & { readonly verdict: "fail"; readonly rejection: RedRejection });

interface Problem {
  readonly reason: TestsRejectedReason;
  readonly label: string;
  readonly detail: string;
}

const REASON_ORDER: readonly TestsRejectedReason[] = ["vacuous", "suite_error", "missing_covers", "orphan_covers", "outside_write_set"];
const OUTPUT_TAIL = 2000;

export function isTaskTestFile(path: string, writes: readonly string[]): boolean {
  return isUnderTests(path) && matchesWriteSet(path, writes);
}

function describeTest(test: TestEntry): string {
  return `${test.file} › ${test.name} (${test.status}${test.status === "failed" ? `, ${test.failureKind}` : ""})`;
}

function wrongReasonTests(tests: readonly TestEntry[]): readonly TestEntry[] {
  return tests.filter((test) => test.status !== "failed" || (test.failureKind !== "assertion" && test.failureKind !== "thrown"));
}

function collectProblems(input: RedInput, covers: CoversEvidence): readonly Problem[] {
  const problems: Problem[] = [];
  if (input.timedOut) {
    problems.push({ reason: "suite_error", label: "timeout", detail: "verifier command timed out" });
  }
  if (input.typecheckExitCode !== 0) {
    problems.push({ reason: "suite_error", label: "suite_error", detail: `typecheck exited ${input.typecheckExitCode}: ${input.typecheckOutput.trim().slice(-OUTPUT_TAIL)}` });
  }
  if (input.report === null) {
    problems.push({ reason: "suite_error", label: "suite_error", detail: "vitest report unreadable" });
  } else {
    const loadFailures = input.report.tests.filter((test) => test.failureKind === "load");
    const taskTests = input.report.tests.filter((test) => test.failureKind !== "load" && isTaskTestFile(test.file, input.writes));
    if (taskTests.length === 0 && loadFailures.length === 0) {
      problems.push({ reason: "vacuous", label: "vacuous", detail: "no tests" });
    }
    const wrong = wrongReasonTests(taskTests);
    if (wrong.length > 0) {
      problems.push({ reason: "vacuous", label: "vacuous", detail: wrong.map(describeTest).join(", ") });
    }
    if (loadFailures.length > 0) {
      problems.push({ reason: "suite_error", label: "suite_error", detail: loadFailures.map((test) => `${test.file}: ${test.message.split("\n")[0] ?? ""}`).join(", ") });
    }
  }
  if (covers.missing.length > 0) {
    problems.push({ reason: "missing_covers", label: "missing_covers", detail: covers.missing.join(", ") });
  }
  if (covers.unknown.length > 0) {
    problems.push({ reason: "orphan_covers", label: "orphan_covers", detail: covers.unknown.join(", ") });
  }
  const outside = input.changedFiles.filter((path) => !isTaskTestFile(path, input.writes));
  if (outside.length > 0) {
    problems.push({ reason: "outside_write_set", label: "outside_write_set", detail: outside.join(", ") });
  }
  if (input.firewallViolations.length > 0) {
    problems.push({ reason: "outside_write_set", label: "outside_write_set", detail: `read under src/: ${input.firewallViolations.join(", ")}` });
  }
  return problems;
}

export function judgeRed(input: RedInput): RedVerdict {
  const covers = coversEvidence(input.covers, input.coversFound);
  const problems = collectProblems(input, covers);
  const testFiles = [...new Set(input.changedFiles.filter((path) => isTaskTestFile(path, input.writes)))];
  const writeSetOk = !problems.some((problem) => problem.reason === "outside_write_set");
  if (problems.length === 0) {
    return { verdict: "pass", reasons: [], rejection: null, covers, writeSetOk, testFiles };
  }
  const reason = REASON_ORDER.find((candidate) => problems.some((problem) => problem.reason === candidate)) ?? "suite_error";
  const detail = problems.map((problem) => `${problem.label}: ${problem.detail}`).join("; ");
  return { verdict: "fail", reasons: [...new Set(problems.map((problem) => problem.label))], rejection: { reason, detail }, covers, writeSetOk, testFiles };
}
