import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunState } from "../../src/bus/domain/run-state.js";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness, TEST_CONFIG, type LaneHarness } from "./support/harness.js";
import { coversMarker, GREEN_IMPL, laneState, provisionLane, RED_TEST, runLaneEffect, type ProvisionedLane } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { scriptedCliRoles, type CliScript, type ScriptedCliRoles } from "./support/runners.js";

const STUB_WITHOUT_IMPORT = "export function greet(name: string): string {\n  return format(name);\n}\n";
const STUB_WITH_IMPORT = 'import { format } from "node:util";\n\nexport function greet(name: string): string {\n  return format(name);\n}\n';
const IMPL_WITH_TYPE_ERROR = "export function greet(name: string): string {\n  const unused: number = name;\n  return `Hello, ${name}!`;\n}\n";

interface FixerLane {
  readonly harness: LaneHarness;
  readonly lane: ProvisionedLane;
  readonly fixer: ScriptedCliRoles;
}

async function aFixerLane(script: CliScript): Promise<FixerLane> {
  const fixer = scriptedCliRoles(script);
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles: fixer, config: { caps: { ...TEST_CONFIG.caps, simpleFixes: 2 } } });
  return { harness, lane: await provisionLane(harness), fixer };
}

async function commitStub(lane: ProvisionedLane, stub: string): Promise<string> {
  await writeProductFile(lane.worktree, "src/greet.ts", stub);
  await git(lane.worktree, ["commit", "-q", "-am", "scaffold stub"]);
  return git(lane.worktree, ["rev-parse", "HEAD"]);
}

async function freezeTests(lane: ProvisionedLane): Promise<string> {
  await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
  await git(lane.worktree, ["add", "-A"]);
  await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
  return git(lane.worktree, ["rev-parse", "HEAD"]);
}

function verifyPending(lane: ProvisionedLane, testsSha: string): RunState {
  return laneState(lane, { status: "verify_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha });
}

const addStubImport: CliScript = async (request) => {
  await writeFile(join(request.cwd, "src/greet.ts"), STUB_WITH_IMPORT, "utf8");
};

describe("simple-fixer in front of the red and green failure paths", () => {
  // @covers build-stage:DLT-005
  it("publishes task.tests_red with testsSha on top of a fix commit when the fixer repairs a red suite_error on the first run", async () => {
    const { harness, lane } = await aFixerLane(addStubImport);
    const baseSha = await commitStub(lane, STUB_WITHOUT_IMPORT);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane, { baseSha }));

    const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
    expect([
      published.map((event) => [event.type, event.payload["outcome"] ?? event.payload["testsSha"] ?? event.payload["reason"]]),
      await git(lane.worktree, ["log", "-3", "--format=%s"]),
      await git(lane.worktree, ["rev-parse", "HEAD~2"]),
    ]).toEqual([
      [
        ["fix.attempted", "fixed"],
        ["task.tests_red", testsSha],
      ],
      "tests T-001\nfix T-001 red 1\nscaffold stub",
      baseSha,
    ]);
  });

  // @covers build-stage:DLT-005
  it("keeps the fixed stub and leaves the test files to the tests commit", async () => {
    const { harness, lane } = await aFixerLane(addStubImport);
    const baseSha = await commitStub(lane, STUB_WITHOUT_IMPORT);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);

    await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane, { baseSha }));

    expect([await git(lane.worktree, ["show", "--name-only", "--format=", "HEAD~1"]), await git(lane.worktree, ["show", "--name-only", "--format=", "HEAD"])]).toEqual(["src/greet.ts", "tests/greet.test.ts"]);
  });

  // @covers build-stage:DLT-005
  it("publishes two fix.attempted and then task.tests_rejected suite_error when the fixer never repairs", async () => {
    const { harness, lane } = await aFixerLane(() => undefined);
    const baseSha = await commitStub(lane, STUB_WITHOUT_IMPORT);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane, { baseSha }));

    expect([published.map((event) => [event.type, event.payload["outcome"] ?? event.payload["reason"]]), await git(lane.worktree, ["rev-parse", "HEAD"])]).toEqual([
      [
        ["fix.attempted", "unfixed"],
        ["fix.attempted", "unfixed"],
        ["task.tests_rejected", "suite_error"],
      ],
      baseSha,
    ]);
  });

  // @covers build-stage:DLT-005
  it("never runs the fixer for a vacuous rejection", async () => {
    const { harness, lane, fixer } = await aFixerLane(addStubImport);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", `import { expect, it } from "vitest";\n${coversMarker("greeter:BEH-001")}\nit("passes", () => {\n  expect(1).toBe(1);\n});\n`);

    const published = await runLaneEffect(harness, "build.red-check", { taskId: "T-001", attempt: 1, firewallViolations: [] }, laneState(lane));

    expect([published.map((event) => [event.type, event.payload["reason"]]), fixer.requests.length]).toEqual([[["task.tests_rejected", "vacuous"]], 0]);
  });

  // @covers build-stage:DLT-005
  it("re-runs the green check after the fixer repairs a typecheck error and commits the implementer attempt", async () => {
    const { harness, lane } = await aFixerLane(async (request) => {
      await writeFile(join(request.cwd, "src/greet.ts"), GREEN_IMPL, "utf8");
    });
    const testsSha = await freezeTests(lane);
    await writeProductFile(lane.worktree, "src/greet.ts", IMPL_WITH_TYPE_ERROR);

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, verifyPending(lane, testsSha));

    const head = await git(lane.worktree, ["rev-parse", "HEAD"]);
    expect([
      published.map((event) => [event.type, event.payload["outcome"] ?? event.payload["result"], event.payload["trigger"] ?? event.payload["implSha"]]),
      await git(lane.worktree, ["log", "-1", "--format=%s"]),
      await readFile(join(lane.worktree, "src/greet.ts"), "utf8"),
    ]).toEqual([
      [
        ["fix.attempted", "fixed", "green_typecheck"],
        ["task.verified", "green", head],
      ],
      "impl T-001 attempt 1",
      GREEN_IMPL,
    ]);
  });

  // @covers build-stage:DLT-005
  it("publishes task.verified red at once without a fixer run when a test fails by assertion", async () => {
    const { harness, lane, fixer } = await aFixerLane(async (request) => {
      await writeFile(join(request.cwd, "src/greet.ts"), GREEN_IMPL, "utf8");
    });
    const testsSha = await freezeTests(lane);
    await writeProductFile(lane.worktree, "src/greet.ts", "export function greet(name: string): string {\n  return name;\n}\n");

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, verifyPending(lane, testsSha));

    expect([published.map((event) => [event.type, event.payload["result"]]), fixer.requests.length]).toEqual([[["task.verified", "red"]], 0]);
  });

  // @covers build-stage:DLT-005
  it("publishes task.verified red after two unfixed green_typecheck runs", async () => {
    const { harness, lane } = await aFixerLane(() => undefined);
    const testsSha = await freezeTests(lane);
    await writeProductFile(lane.worktree, "src/greet.ts", IMPL_WITH_TYPE_ERROR);

    const published = await runLaneEffect(harness, "build.green-check", { taskId: "T-001", attempt: 1 }, verifyPending(lane, testsSha));

    expect(published.map((event) => [event.type, event.payload["outcome"] ?? event.payload["result"]])).toEqual([
      ["fix.attempted", "unfixed"],
      ["fix.attempted", "unfixed"],
      ["task.verified", "red"],
    ]);
  });
});
