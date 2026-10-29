import type { TestEntry, VitestCounters } from "./vitest-report.js";

export type VerifierPhase = "red" | "green";
export type Verdict = "pass" | "fail";

export interface CommandEvidence {
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdoutPath: string;
  readonly stderrPath: string;
}

export interface CoversEvidence {
  readonly required: readonly string[];
  readonly found: readonly string[];
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
}

export interface VerifierEvidence {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly attempt: number;
  readonly phase: VerifierPhase;
  readonly worktree: string;
  readonly baseSha: string;
  readonly testsSha: string | null;
  readonly implSha: string | null;
  readonly commands: readonly CommandEvidence[];
  readonly vitest: VitestCounters;
  readonly tests: readonly TestEntry[];
  readonly covers: CoversEvidence;
  readonly changedFiles: readonly string[];
  readonly writeSetOk: boolean;
  readonly testsUnchanged: boolean | null;
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
}

export const EMPTY_COUNTERS: VitestCounters = { total: 0, passed: 0, failed: 0, skipped: 0, suitesFailedToLoad: 0 };

export function coversEvidence(required: readonly string[], found: readonly string[]): CoversEvidence {
  return {
    required,
    found,
    missing: required.filter((id) => !found.includes(id)),
    unknown: found.filter((id) => !required.includes(id)),
  };
}

export function evidenceFileName(phase: VerifierPhase, attempt: number): string {
  return `verifier-${phase}-${attempt}.json`;
}
