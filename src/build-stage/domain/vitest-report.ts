import { isAbsolute, relative } from "node:path";

export type TestStatus = "passed" | "failed" | "skipped";
export type FailureKind = "assertion" | "thrown" | "load" | "timeout" | "none";

export interface TestEntry {
  readonly file: string;
  readonly name: string;
  readonly status: TestStatus;
  readonly failureKind: FailureKind;
  readonly message: string;
}

export interface VitestCounters {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly suitesFailedToLoad: number;
}

export interface VitestSummary extends VitestCounters {
  readonly tests: readonly TestEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function classifyFailure(message: string): FailureKind {
  if (message.includes("Test timed out")) {
    return "timeout";
  }
  if (message.startsWith("AssertionError") || message.includes("expected")) {
    return "assertion";
  }
  return "thrown";
}

function statusOf(value: unknown): TestStatus {
  return value === "passed" ? "passed" : value === "failed" ? "failed" : "skipped";
}

function relativeFile(name: string, worktree: string): string {
  return isAbsolute(name) ? relative(worktree, name) : name;
}

function entriesOf(suite: Record<string, unknown>, worktree: string): readonly TestEntry[] {
  const file = relativeFile(stringOr(suite["name"], "(unknown)"), worktree);
  const assertions = Array.isArray(suite["assertionResults"]) ? suite["assertionResults"].filter(isRecord) : [];
  if (suite["status"] === "failed" && assertions.length === 0) {
    return [{ file, name: file, status: "failed", failureKind: "load", message: stringOr(suite["message"], "suite failed to load") }];
  }
  return assertions.map((assertion) => {
    const status = statusOf(assertion["status"]);
    const messages = Array.isArray(assertion["failureMessages"]) ? assertion["failureMessages"].filter((item): item is string => typeof item === "string") : [];
    const message = messages[0] ?? "";
    return { file, name: stringOr(assertion["fullName"], stringOr(assertion["title"], "(unnamed)")), status, failureKind: status === "failed" ? classifyFailure(message) : "none", message };
  });
}

export function parseVitestReport(text: string, worktree: string): VitestSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["testResults"])) {
    return null;
  }
  const suites = parsed["testResults"].filter(isRecord);
  const tests = suites.flatMap((suite) => entriesOf(suite, worktree));
  return {
    total: integerOr(parsed["numTotalTests"], 0),
    passed: integerOr(parsed["numPassedTests"], 0),
    failed: integerOr(parsed["numFailedTests"], 0),
    skipped: integerOr(parsed["numPendingTests"], 0) + integerOr(parsed["numTodoTests"], 0),
    suitesFailedToLoad: tests.filter((test) => test.failureKind === "load").length,
    tests,
  };
}
