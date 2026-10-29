import type { Verdict } from "./verifier-evidence.js";
import type { VitestSummary } from "./vitest-report.js";
import { isUnderTests, matchesWriteSet } from "./write-set.js";

export interface GreenInput {
  readonly timedOut: boolean;
  readonly typecheckExitCode: number;
  readonly report: VitestSummary | null;
  readonly changedFiles: readonly string[];
  readonly writes: readonly string[];
  readonly testsUnchanged: boolean;
}

export interface GreenVerdict {
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
  readonly writeSetOk: boolean;
  readonly offendingFiles: readonly string[];
}

export function isOutsideImplementerScope(path: string, writes: readonly string[]): boolean {
  return isUnderTests(path) || !matchesWriteSet(path, writes);
}

export function judgeGreen(input: GreenInput): GreenVerdict {
  const reasons: string[] = [];
  if (input.timedOut) {
    reasons.push("timeout");
  }
  if (input.typecheckExitCode !== 0) {
    reasons.push("typecheck");
  }
  if (input.report === null) {
    reasons.push("suite_error");
  } else {
    if (input.report.suitesFailedToLoad > 0) {
      reasons.push("suite_error");
    }
    if (input.report.failed > 0) {
      reasons.push("tests_failed");
    }
  }
  if (!input.testsUnchanged) {
    reasons.push("tests_changed");
  }
  const offendingFiles = input.changedFiles.filter((path) => isOutsideImplementerScope(path, input.writes));
  if (offendingFiles.length > 0) {
    reasons.push("write_set");
  }
  return { verdict: reasons.length === 0 ? "pass" : "fail", reasons, writeSetOk: offendingFiles.length === 0, offendingFiles };
}
