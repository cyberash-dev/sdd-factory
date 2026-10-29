import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness, type LaneHarness } from "./support/harness.js";
import { coversMarker, laneState, provisionLane, RED_TEST, runLaneEffect, type ProvisionedLane } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";

async function laneWith(files: Readonly<Record<string, string>>): Promise<{ readonly harness: LaneHarness; readonly lane: ProvisionedLane }> {
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign() });
  const lane = await provisionLane(harness);
  for (const [path, content] of Object.entries(files)) {
    await writeProductFile(lane.worktree, path, content);
  }
  return { harness, lane };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function evidence(harness: LaneHarness, attempt = 1): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(join(harness.context.paths.handoffsDir, "tasks", "T-001", `verifier-red-${attempt}.json`), "utf8"));
  return isRecord(parsed) ? parsed : {};
}

describe("red check on a real worktree", () => {
  // @covers build-stage:BEH-003
  // @covers build-stage:EXT-002
  it("freezes tests that fail by throwing at the stub as a commit and reports testsSha with the test files", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": RED_TEST });

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    const head = await git(lane.worktree, ["rev-parse", "HEAD"]);
    const written = await evidence(harness);
    expect([published, head === lane.baseSha, await git(lane.worktree, ["log", "-1", "--format=%s"]), written["verdict"], written["testsSha"], written["reasons"]]).toEqual([
      [{ type: "task.tests_red", producer: "foreman", payload: { taskId: "T-001", testsSha: head, testFiles: ["tests/greet.test.ts"] } }],
      false,
      "tests T-001",
      "pass",
      head,
      [],
    ]);
  });

  it("rejects a passing test as vacuous and leaves the worktree head at baseSha", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": `import { expect, it } from "vitest";\n${coversMarker("greeter:BEH-001")}\nit("passes", () => {\n  expect(1).toBe(1);\n});\n` });

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    expect([published.map((event) => [event.type, event.payload["reason"]]), await git(lane.worktree, ["rev-parse", "HEAD"])]).toEqual([[["task.tests_rejected", "vacuous"]], lane.baseSha]);
  });

  // @covers build-stage:CTR-002
  it("rejects a suite that fails to load as suite_error with one load entry in the evidence", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": `import { it } from "vitest";\n${coversMarker("greeter:BEH-001")}\nit("broken", () => { const x = ; });\n` });

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    const written = await evidence(harness);
    const tests = Array.isArray(written["tests"]) ? written["tests"] : [];
    expect([published.map((event) => [event.type, event.payload["reason"]]), written["verdict"], tests.map((test: { file: string; failureKind: string }) => [test.file, test.failureKind])]).toEqual([
      [["task.tests_rejected", "suite_error"]],
      "fail",
      [["tests/greet.test.ts", "load"]],
    ]);
  });

  it("rejects tests whose markers do not cover every id", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": RED_TEST.replace(`${coversMarker("greeter:BEH-001")}\n`, "") });

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    expect(published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])).toEqual([["task.tests_rejected", "missing_covers", "missing_covers: greeter:BEH-001"]]);
  });

  it("rejects a change under src/ as outside_write_set and does not commit", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": RED_TEST, "src/greet.ts": 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n' });

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    expect([published.map((event) => [event.type, event.payload["reason"]]), await git(lane.worktree, ["rev-parse", "HEAD"])]).toEqual([[["task.tests_rejected", "vacuous"]], lane.baseSha]);
  });

  it("rejects a test with a typecheck error as suite_error carrying the tsc diagnostic", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": RED_TEST.replace('greet("Ada")', "greet(42)") });

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    expect([published[0]?.payload["reason"], String(published[0]?.payload["detail"]).includes("TS2345")]).toEqual(["suite_error", true]);
  });

  it("reports a firewall violation as outside_write_set even when the tests themselves are red", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": RED_TEST });

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: ["Read:src/index.ts"] }, laneState(lane));

    expect(published.map((event) => [event.type, event.payload["reason"], event.payload["detail"]])).toEqual([["task.tests_rejected", "outside_write_set", "outside_write_set: read under src/: Read:src/index.ts"]]);
  });

  it("writes the evidence file before publishing with the commands, counters and covers", async () => {
    const { harness, lane } = await laneWith({ "tests/greet.test.ts": RED_TEST });

    await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    const written = await evidence(harness);
    const commands = Array.isArray(written["commands"]) ? written["commands"] : [];
    expect([written["schemaVersion"], written["phase"], written["baseSha"], commands.map((command: { argv: string[]; exitCode: number }) => [command.argv[1], command.exitCode]), written["vitest"], written["covers"], written["changedFiles"], written["testsUnchanged"]]).toEqual([
      1,
      "red",
      lane.baseSha,
      [["tsc", 0], ["vitest", 1]],
      { total: 1, passed: 0, failed: 1, skipped: 0, suitesFailedToLoad: 0 },
      { required: ["greeter:BEH-001"], found: ["greeter:BEH-001"], missing: [], unknown: [] },
      ["tests/greet.test.ts"],
      null,
    ]);
  });
});
