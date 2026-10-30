export interface FailingTest {
  readonly file: string;
  readonly name: string;
  readonly message: string;
}

export interface VitestSummary {
  readonly success: boolean;
  readonly failingFiles: readonly string[];
  readonly failingTests: readonly FailingTest[];
  readonly loadFailures: readonly string[];
  readonly failedAssertions: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function failedAssertionsOf(suite: Record<string, unknown>): readonly Record<string, unknown>[] {
  const assertions = Array.isArray(suite["assertionResults"]) ? suite["assertionResults"] : [];
  return assertions.filter((assertion): assertion is Record<string, unknown> => isRecord(assertion) && assertion["status"] === "failed");
}

function failingAssertions(file: string, suite: Record<string, unknown>): readonly FailingTest[] {
  const failed = failedAssertionsOf(suite);
  if (failed.length === 0) {
    return [{ file, name: "(suite)", message: stringOr(suite["message"], "suite failed to run") }];
  }
  return failed.map((assertion) => {
    const messages = Array.isArray(assertion["failureMessages"]) ? assertion["failureMessages"].filter((item): item is string => typeof item === "string") : [];
    return { file, name: stringOr(assertion["fullName"], stringOr(assertion["title"], "(unnamed)")), message: messages.join("\n") };
  });
}

export function parseVitestReport(text: string): VitestSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["testResults"])) {
    return null;
  }
  const failedSuites = parsed["testResults"].filter((suite): suite is Record<string, unknown> => isRecord(suite) && suite["status"] === "failed");
  const failingFiles = failedSuites.map((suite) => stringOr(suite["name"], "(unknown file)"));
  const failingTests = failedSuites.flatMap((suite) => failingAssertions(stringOr(suite["name"], "(unknown file)"), suite));
  const loadFailures = failedSuites.filter((suite) => failedAssertionsOf(suite).length === 0).map((suite) => stringOr(suite["name"], "(unknown file)"));
  const failedAssertions = failedSuites.reduce((count, suite) => count + failedAssertionsOf(suite).length, 0);
  return { success: parsed["success"] === true && failedSuites.length === 0, failingFiles, failingTests, loadFailures, failedAssertions };
}
