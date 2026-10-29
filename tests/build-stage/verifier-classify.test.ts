import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { judgeGreen } from "../../src/build-stage/domain/green-verdict.js";
import { judgeRed, type RedInput } from "../../src/build-stage/domain/red-verdict.js";
import { coversEvidence, evidenceFileName, type VerifierEvidence } from "../../src/build-stage/domain/verifier-evidence.js";
import { classifyFailure, parseVitestReport, type VitestSummary } from "../../src/build-stage/domain/vitest-report.js";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/vitest-report-${name}.json`, import.meta.url), "utf8");
}

function summary(tests: VitestSummary["tests"], overrides: Partial<VitestSummary> = {}): VitestSummary {
  return {
    total: tests.length,
    passed: tests.filter((test) => test.status === "passed").length,
    failed: tests.filter((test) => test.status === "failed").length,
    skipped: tests.filter((test) => test.status === "skipped").length,
    suitesFailedToLoad: tests.filter((test) => test.failureKind === "load").length,
    tests,
    ...overrides,
  };
}

const assertionTest = { file: "tests/greet.test.ts", name: "greets", status: "failed", failureKind: "assertion", message: "AssertionError: expected 'a' to be 'b'" } as const;
const thrownTest = { file: "tests/greet.test.ts", name: "throws", status: "failed", failureKind: "thrown", message: "Error: not implemented: greet" } as const;
const passingTest = { file: "tests/greet.test.ts", name: "passes", status: "passed", failureKind: "none", message: "" } as const;
const loadTest = { file: "tests/broken.test.ts", name: "tests/broken.test.ts", status: "failed", failureKind: "load", message: "Transform failed" } as const;

function redInput(overrides: Partial<RedInput> = {}): RedInput {
  return {
    timedOut: false,
    typecheckExitCode: 0,
    typecheckOutput: "",
    report: summary([assertionTest]),
    changedFiles: ["tests/greet.test.ts"],
    writes: ["src/greet.ts", "tests/greet.test.ts"],
    covers: ["greeter:BEH-001"],
    coversFound: ["greeter:BEH-001"],
    firewallViolations: [],
    ...overrides,
  };
}

describe("vitest JSON reporter contract", () => {
  // @covers build-stage:EXT-002
  it.each([
    ["pass", [["tests/pass.test.ts", "adds", "passed", "none"], ["tests/pass.test.ts", "concats", "passed", "none"]]],
    ["assertion", [["tests/assertion.test.ts", "greets by name", "failed", "assertion"]]],
    ["thrown", [["tests/thrown.test.ts", "throws from the stub", "failed", "thrown"]]],
    ["load", [["tests/load.test.ts", "tests/load.test.ts", "failed", "load"]]],
    ["timeout", [["tests/timeout.test.ts", "times out", "failed", "timeout"]]],
  ])("classifies every test of the recorded %s report", async (name, expected) => {
    const report = parseVitestReport(await fixture(name), "/wt");

    expect(report?.tests.map((test) => [test.file, test.name, test.status, test.failureKind])).toEqual(expected);
  });

  // @covers build-stage:ASM-002
  it("derives the counters from the top-level numbers and counts the load failure fixture as one failed suite", async () => {
    const report = parseVitestReport(await fixture("load"), "/wt");

    expect([report?.total, report?.passed, report?.failed, report?.skipped, report?.suitesFailedToLoad]).toEqual([0, 0, 0, 0, 1]);
  });

  it("returns null for a report that is not JSON", () => {
    expect(parseVitestReport("not json", "/wt")).toBeNull();
  });

  it.each([
    ["AssertionError: expected 1 to be 2", "assertion"],
    ["Error: expected something else", "assertion"],
    ["Error: Test timed out in 50ms.", "timeout"],
    ["TypeError: x is not a function", "thrown"],
  ])("classifies the failure message %j as %s", (message, kind) => {
    expect(classifyFailure(message)).toBe(kind);
  });
});

describe("red check verdict", () => {
  // @covers build-stage:BEH-003
  it("passes when every task test fails by assertion or throw, markers match and only test files changed", () => {
    const verdict = judgeRed(redInput({ report: summary([assertionTest, thrownTest]) }));

    expect([verdict.verdict, verdict.reasons, verdict.rejection, verdict.testFiles]).toEqual(["pass", [], null, ["tests/greet.test.ts"]]);
  });

  it.each([
    ["one passing test", redInput({ report: summary([assertionTest, passingTest]) }), "vacuous"],
    ["no tests", redInput({ report: summary([]) }), "vacuous"],
    ["a timed-out test", redInput({ report: summary([{ ...assertionTest, failureKind: "timeout" }]) }), "vacuous"],
    ["a suite failing to load", redInput({ report: summary([assertionTest, loadTest]) }), "suite_error"],
    ["a typecheck failure", redInput({ typecheckExitCode: 2, typecheckOutput: "error TS2345" }), "suite_error"],
    ["an unreadable report", redInput({ report: null }), "suite_error"],
    ["a marker missing for a covered id", redInput({ coversFound: [] }), "missing_covers"],
    ["a marker for an unknown id", redInput({ coversFound: ["greeter:BEH-001", "greeter:BEH-999"] }), "orphan_covers"],
    ["a change under src/", redInput({ changedFiles: ["tests/greet.test.ts", "src/greet.ts"] }), "outside_write_set"],
    ["a test file outside tests/", redInput({ changedFiles: ["tests/greet.test.ts", "src/greet.test.ts"], writes: ["src/**", "tests/**"] }), "outside_write_set"],
    ["a read under src/ reported by the firewall", redInput({ firewallViolations: ["Read:src/index.ts"] }), "outside_write_set"],
  ])("rejects %s with reason %s", (_label, input, reason) => {
    const verdict = judgeRed(input);

    expect([verdict.verdict, verdict.rejection?.reason]).toEqual(["fail", reason]);
  });

  it("reports the first reason in the order vacuous, suite_error, missing_covers, orphan_covers, outside_write_set and lists all in detail", () => {
    const verdict = judgeRed(redInput({ report: summary([passingTest, loadTest]), coversFound: [], changedFiles: ["src/x.ts"] }));

    expect([verdict.rejection?.reason, verdict.reasons]).toEqual(["vacuous", ["vacuous", "suite_error", "missing_covers", "outside_write_set"]]);
  });

  it("explains a typecheck failure with the tsc output in detail", () => {
    const verdict = judgeRed(redInput({ typecheckExitCode: 2, typecheckOutput: "tests/greet.test.ts(3,1): error TS2345: wrong arg" }));

    expect(verdict.rejection?.detail).toBe("suite_error: typecheck exited 2: tests/greet.test.ts(3,1): error TS2345: wrong arg");
  });

  it("ignores passing tests of other tasks' files when judging the task's own files", () => {
    const verdict = judgeRed(redInput({ report: summary([assertionTest, { ...passingTest, file: "tests/other.test.ts" }]) }));

    expect(verdict.verdict).toBe("pass");
  });
});

describe("green check verdict", () => {
  const green = { timedOut: false, typecheckExitCode: 0, report: summary([passingTest]), changedFiles: ["src/greet.ts"], writes: ["src/greet.ts", "tests/greet.test.ts"], testsUnchanged: true };

  // @covers build-stage:BEH-006
  it("passes a typecheck-clean fully green run inside the write-set with frozen tests untouched", () => {
    expect(judgeGreen(green)).toEqual({ verdict: "pass", reasons: [], writeSetOk: true, offendingFiles: [] });
  });

  it.each([
    ["one failing test", { ...green, report: summary([assertionTest]) }, ["tests_failed"], true],
    ["a typecheck error", { ...green, typecheckExitCode: 1 }, ["typecheck"], true],
    ["a load failure", { ...green, report: summary([passingTest, loadTest]) }, ["suite_error", "tests_failed"], true],
    ["an edited test file", { ...green, testsUnchanged: false, changedFiles: ["src/greet.ts", "tests/greet.test.ts"] }, ["tests_changed", "write_set"], false],
    ["a new file outside the write-set", { ...green, changedFiles: ["src/greet.ts", "src/other.ts"] }, ["write_set"], false],
    ["a new test file", { ...green, changedFiles: ["src/greet.ts", "tests/extra.test.ts"] }, ["write_set"], false],
    ["a timeout", { ...green, timedOut: true }, ["timeout"], true],
  ])("fails on %s", (_label, input, reasons, writeSetOk) => {
    const verdict = judgeGreen(input);

    expect([verdict.verdict, verdict.reasons, verdict.writeSetOk]).toEqual(["fail", reasons, writeSetOk]);
  });

  // @covers build-stage:INV-002
  it("names every path outside the write-set or under tests/ as offending so the lane can revert it", () => {
    const verdict = judgeGreen({ ...green, changedFiles: ["src/greet.ts", "src/other/file.ts", "tests/extra.test.ts", "package.json"] });

    expect(verdict.offendingFiles).toEqual(["src/other/file.ts", "tests/extra.test.ts", "package.json"]);
  });
});

describe("verifier evidence contract", () => {
  // @covers build-stage:CTR-002
  it("serialises a red pass with every schema key, an empty reasons list and testsUnchanged null", () => {
    const evidence: VerifierEvidence = {
      schemaVersion: 1,
      taskId: "T-001",
      attempt: 1,
      phase: "red",
      worktree: "/wt",
      baseSha: "1111111111111111111111111111111111111111",
      testsSha: "2222222222222222222222222222222222222222",
      implSha: null,
      commands: [{ argv: ["npx", "tsc", "--noEmit"], exitCode: 0, durationMs: 300, stdoutPath: "/h/typecheck.stdout", stderrPath: "/h/typecheck.stderr" }],
      vitest: { total: 1, passed: 0, failed: 1, skipped: 0, suitesFailedToLoad: 0 },
      tests: [assertionTest],
      covers: coversEvidence(["greeter:BEH-001"], ["greeter:BEH-001"]),
      changedFiles: ["tests/greet.test.ts"],
      writeSetOk: true,
      testsUnchanged: null,
      verdict: "pass",
      reasons: [],
    };

    const parsed: unknown = JSON.parse(JSON.stringify(evidence));

    expect(Object.keys(typeof parsed === "object" && parsed !== null ? parsed : {}).sort()).toEqual([
      "attempt",
      "baseSha",
      "changedFiles",
      "commands",
      "covers",
      "implSha",
      "phase",
      "reasons",
      "schemaVersion",
      "taskId",
      "tests",
      "testsSha",
      "testsUnchanged",
      "verdict",
      "vitest",
      "worktree",
      "writeSetOk",
    ]);
  });

  it("computes missing and unknown covers from required and found", () => {
    expect(coversEvidence(["a:1", "a:2"], ["a:2", "a:3"])).toEqual({ required: ["a:1", "a:2"], found: ["a:2", "a:3"], missing: ["a:1"], unknown: ["a:3"] });
  });

  it("names the evidence file by phase and attempt", () => {
    expect([evidenceFileName("red", 1), evidenceFileName("green", 3)]).toEqual(["verifier-red-1.json", "verifier-green-3.json"]);
  });
});
