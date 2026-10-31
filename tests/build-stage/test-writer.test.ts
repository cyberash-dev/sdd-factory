import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness } from "./support/harness.js";
import { handoffPathFromWorktree, handoffPathOf, laneState, provisionLane, RED_TEST, runLaneEffect } from "./support/lanes.js";
import { aProductRepo, writeProductFile } from "./support/product.js";
import { scriptedCliRoles, writeHandoff } from "./support/runners.js";

const RECORD = "id: greeter:BEH-001\ntype: Behavior\ntitle: greet by name\nthen: |\n  greet(name) returns \"Hello, <name>!\"\n";

function completeHandoff(attempt = 1): Readonly<Record<string, unknown>> {
  return { role: "test-writer", attempt, status: "complete", test_files: ["tests/greet.test.ts"], covers: ["greeter:BEH-001"], blocked_reason: "" };
}

describe("test-writer invocation", () => {
  // @covers build-stage:BEH-002
  it("sends the first message with every input and publishes task.tests_written with the runner's cost fields", async () => {
    const productDir = await aProductRepo();
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeProductFile(request.cwd, "tests/greet.test.ts", RED_TEST);
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), completeHandoff());
    });
    const harness = await aLaneHarness({ productDir, design: greeterDesign(), cliRoles, commands: { records: { "greeter:BEH-001": RECORD } } });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    const request = cliRoles.requests[0];
    const message = request?.prompt.split("\n\n---\n\n")[1] ?? "";
    expect([
      request?.binary,
      request?.cwd,
      request?.addDirs,
      ["T-001", RECORD.trimEnd(), "design/verification.md", "input_classes", "export function greet(name: string): string;", '"writes": [', "npx vitest run", "npx tsc --noEmit", handoffPathOf(harness, "test-writer", 1), "## Rework finding\n\nnone"].map((item) => message.includes(item)),
      published,
    ]).toEqual([
      "claude",
      lane.worktree,
      [lane.worktree, dirname(handoffPathOf(harness, "test-writer", 1))],
      [true, true, true, true, true, true, true, true, true, true],
      [{ type: "task.tests_written", producer: "test-writer", payload: { taskId: "T-001", attempt: 1, handoffPath: handoffPathOf(harness, "test-writer", 1), costUsd: 0.05, inputTokens: 1000, outputTokens: 200, durationMs: 1500, firewallViolations: [] } }],
    ]);
  });

  it("carries the rework finding text and the referenced file content into the first message of a rework attempt", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 2), completeHandoff(2));
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);
    await writeProductFile(harness.context.paths.runDir, "finding.md", "RV-001: test contradicts greeter:BEH-001.then\n");

    await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 2, reworkFinding: { reason: "review_changes", findingPath: join(harness.context.paths.runDir, "finding.md") } }, laneState(lane, { attempts: { implementer: 0, testWriter: 2 } }));

    const prompt = cliRoles.requests[0]?.prompt ?? "";
    expect([prompt.includes("## Rework finding\n\nreview_changes\nsource: "), prompt.includes("RV-001: test contradicts greeter:BEH-001.then"), prompt.includes("This is attempt 2 for this role on this task.")]).toEqual([true, true, true]);
  });

  it("publishes task.failed with reason blocked when the handoff declares blocked", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), { ...completeHandoff(), status: "blocked", blocked_reason: "greeter:BEH-001 has no entry point" });
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect(published).toEqual([{ type: "task.failed", producer: "test-writer", payload: { taskId: "T-001", reason: "blocked", detail: "test-writer: greeter:BEH-001 has no entry point" } }]);
  });

  // @covers build-stage:BEH-015
  it("re-invokes once with the parse error when the handoff is missing and fails the task after the second miss", async () => {
    const cliRoles = scriptedCliRoles(() => undefined);
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect([cliRoles.requests.length, cliRoles.requests[1]?.prompt.includes("could not be parsed: `missing_file`"), published]).toEqual([
      2,
      true,
      [{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "unparseable_handoff", detail: "test-writer: missing_file" } }],
    ]);
  });

  it("keeps a handoff missing a required key as .rejected-1 and accepts the corrected second handoff at the same attempt", async () => {
    const cliRoles = scriptedCliRoles(async (request, invocation) => {
      const path = handoffPathFromWorktree(request.cwd, "test-writer", 1);
      await writeHandoff(path, invocation === 1 ? { role: "test-writer", attempt: 1, status: "complete", test_files: [] } : completeHandoff());
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect([cliRoles.requests[1]?.prompt.includes("missing_required_key:covers"), (await readdir(dirname(handoffPathOf(harness, "test-writer", 1)))).sort(), published.map((event) => [event.type, event.payload["attempt"]])]).toEqual([
      true,
      ["handoff.md", "handoff.md.rejected-1"],
      [["task.tests_written", 1]],
    ]);
  });

  // @covers build-stage:EXT-001
  it("retries exactly once after a rate-limited result and publishes the second result", async () => {
    const cliRoles = scriptedCliRoles(async (request, invocation) => {
      if (invocation === 1) {
        return { result: { isError: true, costUsd: 0, inputTokens: 1, outputTokens: 1, durationMs: 10, resultText: "API Error: 429 rate_limit_error", dominantModel: null } };
      }
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), completeHandoff());
      return { result: { isError: false, costUsd: 0.07, inputTokens: 9, outputTokens: 4, durationMs: 20, resultText: "ok", dominantModel: null } };
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect([cliRoles.requests.length, published.map((event) => [event.type, event.payload["costUsd"]])]).toEqual([2, [["task.tests_written", 0.07]]]);
  });

  // @covers build-stage:INV-003
  it("reports reads under src/ other than the named stubs as firewall violations on task.tests_written", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), completeHandoff());
      return { toolUses: [{ name: "Read", input: { file_path: `${request.cwd}/src/greet.ts` } }, { name: "Read", input: { file_path: `${request.cwd}/src/index.ts` } }] };
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect(published.map((event) => event.payload["firewallViolations"])).toEqual([["Read:src/index.ts"]]);
  });

  it("drops the result of a lane that was cancelled while the subprocess ran", async () => {
    let shutdown: () => Promise<void> = async () => undefined;
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), completeHandoff());
      await shutdown();
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    shutdown = harness.slice.shutdown ?? shutdown;
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect([published, harness.logs.at(-1)]).toEqual([[], "test-writer result dropped for cancelled lane T-001"]);
  });

  // @covers build-stage:CST-006
  it("runs two attempts of the test-writer as two distinct subprocess invocations with cost on each event", async () => {
    const cliRoles = scriptedCliRoles(async (request, invocation) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", invocation), completeHandoff(invocation));
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const first = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));
    const second = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 2, reworkFinding: { reason: "vacuous: no tests", findingPath: null } }, laneState(lane, { attempts: { implementer: 0, testWriter: 2 } }));

    expect([cliRoles.requests.length, cliRoles.requests[0] === cliRoles.requests[1], [...first, ...second].map((event) => [event.payload["attempt"], event.payload["costUsd"], event.payload["durationMs"]])]).toEqual([2, false, [[1, 0.05, 1500], [2, 0.05, 1500]]]);
  });

  it("includes the inlined record text fetched through sdd record get for every covered id", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), completeHandoff());
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles, commands: { records: { "greeter:BEH-001": RECORD } } });
    const lane = await provisionLane(harness);

    await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect(harness.commands.calls.filter((call) => call.command === "npx").map((call) => [call.args.join(" "), call.cwd])).toEqual([["sdd record get greeter:BEH-001", harness.context.paths.productDir]]);
  });

  it("renders the instruction prompt without unresolved placeholders", async () => {
    const cliRoles = scriptedCliRoles(async (request) => {
      await writeHandoff(handoffPathFromWorktree(request.cwd, "test-writer", 1), completeHandoff());
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    const instruction = cliRoles.requests[0]?.prompt.split("\n\n---\n\n")[0] ?? "";
    expect([/\{\{[a-z_]+\}\}/.test(instruction), instruction.startsWith((await readFile(join(harness.context.paths.repoRoot, "prompts", "test-writer.md"), "utf8")).slice(0, 20))]).toEqual([false, true]);
  });

  // @covers build-stage:BEH-016
  it("publishes nothing and starts no re-run when the test-writer subprocess ended on a termination signal", async () => {
    const cliRoles = scriptedCliRoles(() => ({ exitCode: null, signal: "SIGTERM", result: null }));
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect([cliRoles.requests.length, published]).toEqual([1, []]);
  });

  // @covers build-stage:BEH-016
  it("does not retry a rate-limited result whose subprocess ended on a termination signal", async () => {
    const cliRoles = scriptedCliRoles(() => ({ exitCode: null, signal: "SIGTERM", result: { isError: true, costUsd: 0, inputTokens: 1, outputTokens: 1, durationMs: 10, resultText: "API Error: 429 rate_limit_error", dominantModel: null } }));
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect(cliRoles.requests.length).toBe(1);
  });

  // @covers build-stage:BEH-015
  it("still re-runs a test-writer whose subprocess was killed by its own timeout", async () => {
    const cliRoles = scriptedCliRoles(() => ({ exitCode: null, signal: "SIGTERM", timedOut: true, result: null }));
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), cliRoles });
    const lane = await provisionLane(harness);

    const published = await runLaneEffect(harness, "build.test-writer", { taskId: "T-001", attempt: 1, reworkFinding: null }, laneState(lane));

    expect([cliRoles.requests.length, published.map((event) => [event.type, event.payload["reason"]])]).toEqual([2, [["task.failed", "unparseable_handoff"]]]);
  });
});
