import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiRoleRequest } from "../../src/shared/llm/api-role-runner.js";
import type { CliRoleRequest } from "../../src/shared/llm/cli-role-runner.js";
import type { DesignBundle } from "../../src/build-stage/index.js";
import { aModule, aTaskSpec, greeterDesign } from "./support/design.js";
import { aLaneHarness, eventTypes, hasEvent, laneEngine, type LaneEngine, type LaneHarness } from "./support/harness.js";
import { GREEN_IMPL, RED_TEST } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { invokeTool, reviewFrontmatter, scriptedApiRoles, scriptedCliRoles, writeHandoff, type CliScript } from "./support/runners.js";
import { aTask, buildingState } from "./support/state.js";
import type { TaskState } from "../../src/bus/domain/run-state.js";

const LANE_TIMEOUT = 90_000;

interface LaneInvocation {
  readonly role: "test-writer" | "implementer";
  readonly attempt: number;
  readonly handoffPath: string;
  readonly worktree: string;
  readonly taskId: string;
}

function invocationOf(request: CliRoleRequest): LaneInvocation {
  const match = /handoff to `([^`]+\/tasks\/(T-\d{3})\/(test-writer|implementer)-(\d+)\/handoff\.md)`/.exec(request.prompt);
  if (match === null) {
    throw new Error("prompt names no lane handoff path");
  }
  return { role: match[3] === "implementer" ? "implementer" : "test-writer", attempt: Number(match[4]), handoffPath: match[1] ?? "", worktree: request.cwd, taskId: match[2] ?? "" };
}

async function writeTests(invocation: LaneInvocation, test = RED_TEST): Promise<void> {
  await writeProductFile(invocation.worktree, "tests/greet.test.ts", test);
  await writeHandoff(invocation.handoffPath, { role: "test-writer", attempt: invocation.attempt, status: "complete", test_files: ["tests/greet.test.ts"], covers: ["greeter:BEH-001"], blocked_reason: "" });
}

async function writeImplementation(invocation: LaneInvocation, source = GREEN_IMPL): Promise<void> {
  await writeProductFile(invocation.worktree, "src/greet.ts", source);
  await writeHandoff(invocation.handoffPath, { role: "implementer", attempt: invocation.attempt, status: "complete", changed_files: ["src/greet.ts"] });
}

async function writeFinding(invocation: LaneInvocation, type: string, detail: string): Promise<void> {
  await writeHandoff(invocation.handoffPath, { role: "implementer", attempt: invocation.attempt, status: "finding", changed_files: [], finding: { type, spec_ids: ["greeter:BEH-001"], detail } });
}

async function writeReview(request: ApiRoleRequest, overrides: Readonly<Record<string, unknown>>): Promise<void> {
  const attempt = Number((request.message.match(/attempt (\d+), mode/) ?? [])[1] ?? "1");
  const implSha = (request.message.match(/Reviewed commit: ([0-9a-f]{40})/) ?? [])[1] ?? null;
  const mode = request.message.includes("mode arbitration") ? "arbitration" : "review";
  const text = `---\n${JSON.stringify(reviewFrontmatter({ attempt, impl_sha: implSha, mode, ...overrides }))}\n---\n## Scope checked\n\n## Spec conformance\n\n## Findings\n\n## Verdict rationale\n`;
  await invokeTool(request, "write_file", { path: "reviews/T-001.md", content: text });
  await invokeTool(request, "write_file", { path: `.handoff/reviewer-${attempt}.md`, content: text });
}

const approveReview = (request: ApiRoleRequest): Promise<void> => writeReview(request, {});
const happyLane: CliScript = async (request) => {
  const invocation = invocationOf(request);
  await (invocation.role === "test-writer" ? writeTests(invocation) : writeImplementation(invocation));
};

interface Scenario {
  readonly harness: LaneHarness;
  readonly engine: LaneEngine;
  readonly productDir: string;
}

async function scenario(cli: CliScript, api: (request: ApiRoleRequest) => Promise<void> = approveReview, design: DesignBundle = greeterDesign(), tasks: Readonly<Record<string, TaskState>> = { "T-001": aTask() }): Promise<Scenario> {
  const productDir = await aProductRepo();
  const harness = await aLaneHarness({ productDir, design, cliRoles: scriptedCliRoles(cli), apiRoles: scriptedApiRoles(api) });
  const engine = laneEngine(harness, buildingState(tasks));
  await engine.runEffect({ kind: "build.schedule" });
  return { harness, engine, productDir };
}

const laneEnded = hasEvent("task.approved");
const runEnded = (events: Parameters<typeof eventTypes>[0]): boolean => events.some((event) => event.type === "run.failed");

describe("build lane end to end", () => {
  // @covers build-stage:SCN-001
  // @covers build-stage:INV-005
  it("runs the happy lane through the seven events, merges the task into integration and starts the assembly", async () => {
    const { harness, engine, productDir } = await scenario(happyLane);

    await engine.waitFor(laneEnded, LANE_TIMEOUT);

    const approved = engine.events.find((event) => event.type === "task.approved");
    const task = engine.state().tasks["T-001"];
    const worktree = task?.worktree ?? "";
    const evidence: unknown = JSON.parse(await readFile(join(harness.context.paths.handoffsDir, "tasks", "T-001", "verifier-green-1.json"), "utf8"));
    expect([
      eventTypes(engine.events),
      engine.events.map((event) => [event.payload["result"], event.payload["decision"]]).filter((pair) => pair.some((item) => item !== undefined)),
      approved?.payload["implSha"] === (await git(worktree, ["rev-parse", "HEAD"])),
      typeof evidence === "object" && evidence !== null && "implSha" in evidence ? evidence.implSha === approved?.payload["implSha"] : null,
      await git(worktree, ["diff", "--quiet", task?.testsSha ?? "", "--", "tests/greet.test.ts"]).then(() => "identical"),
      await git(productDir, ["log", "--topo-order", "--format=%s", "integration"]),
      await readFile(join(productDir, "src/greet.ts"), "utf8"),
      engine.foreignEffects,
      task?.status,
    ]).toEqual([
      ["task.ready", "task.tests_written", "task.tests_red", "task.impl_done", "task.verified", "task.reviewed", "task.approved"],
      [["green", undefined], [undefined, "approve"]],
      true,
      true,
      "identical",
      "review T-001\nmerge T-001\nimpl T-001 attempt 1\ntests T-001\nscaffold T-001\nscaffold product",
      GREEN_IMPL,
      [{ kind: "assembly.start" }],
      "approved",
    ]);
  }, LANE_TIMEOUT);

  // @covers build-stage:SCN-002
  it("retries the implementer once with the red evidence path and approves on the second attempt with tests byte-identical to testsSha", async () => {
    const prompts: string[] = [];
    const { engine } = await scenario(async (request) => {
      const invocation = invocationOf(request);
      if (invocation.role === "test-writer") {
        await writeTests(invocation);
        return;
      }
      prompts.push(request.prompt);
      await writeImplementation(invocation, invocation.attempt === 1 ? "export function greet(name: string): string {\n  return name;\n}\n" : GREEN_IMPL);
    });

    await engine.waitFor(laneEnded, LANE_TIMEOUT);

    const task = engine.state().tasks["T-001"];
    expect([
      eventTypes(engine.events),
      engine.events.filter((event) => event.type === "task.rework" || event.type === "task.impl_done").map((event) => [event.type, event.payload["attempt"]]),
      prompts[1]?.includes(`verification_red\nsource: ${join(dirname(dirname(task?.worktree ?? "")), "handoffs", "tasks", "T-001", "verifier-green-1.json")}`),
      await git(task?.worktree ?? "", ["diff", "--quiet", task?.testsSha ?? "", task?.implSha ?? "", "--", "tests/greet.test.ts"]).then(() => "identical"),
    ]).toEqual([
      ["task.ready", "task.tests_written", "task.tests_red", "task.impl_done", "task.verified", "task.rework", "task.impl_done", "task.verified", "task.reviewed", "task.approved"],
      [["task.impl_done", 1], ["task.rework", 2], ["task.impl_done", 2]],
      true,
      "identical",
    ]);
  }, LANE_TIMEOUT);

  // @covers build-stage:SCN-003
  // @covers build-stage:BEH-004
  it("arbitrates a test-contract conflict to the test-writer, restarts the lane at baseSha and approves after the rewritten tests", async () => {
    const restart: { head: string | null; status: string | null } = { head: null, status: null };
    const { engine } = await scenario(
      async (request) => {
        const invocation = invocationOf(request);
        if (invocation.role === "test-writer") {
          if (invocation.attempt === 2) {
            restart.head = await git(invocation.worktree, ["rev-parse", "HEAD"]);
            restart.status = await git(invocation.worktree, ["status", "--porcelain", "--", ".", ":(exclude)node_modules"]);
          }
          await writeTests(invocation, invocation.attempt === 1 ? RED_TEST.replace('"Hello, Ada!"', '"Hi Ada"') : RED_TEST);
          return;
        }
        if (invocation.attempt === 1 && (await readFile(join(invocation.worktree, "tests/greet.test.ts"), "utf8")).includes("Hi Ada")) {
          await writeProductFile(invocation.worktree, "src/greet.ts", "export function greet(name: string): string {\n  return `partial ${name}`;\n}\n");
          await writeFinding(invocation, "TEST-CONTRACT-CONFLICT", "tests/greet.test.ts:6 expects Hi; greeter:BEH-001.then says Hello");
          return;
        }
        await writeImplementation(invocation);
      },
      (request) => (request.message.includes("mode arbitration") ? writeReview(request, { decision: "request_changes", target: "test-writer", findings: [{ id: "RV-001", severity: "blocking", target: "test-writer", spec_ids: ["greeter:BEH-001"], evidence: "greeter:BEH-001.then: Hello; tests/greet.test.ts:6: Hi" }] }) : approveReview(request)),
    );

    await engine.waitFor(laneEnded, LANE_TIMEOUT);

    const task = engine.state().tasks["T-001"];
    expect([
      eventTypes(engine.events),
      engine.events.filter((event) => event.type === "task.reviewed").map((event) => [event.payload["decision"], event.payload["target"]]),
      engine.events.filter((event) => event.type === "task.impl_done").map((event) => event.payload["attempt"]),
      restart.head === task?.baseSha,
      restart.status,
      task?.attempts,
    ]).toEqual([
      ["task.ready", "task.tests_written", "task.tests_red", "task.finding", "task.reviewed", "task.rework", "task.tests_written", "task.tests_red", "task.impl_done", "task.verified", "task.reviewed", "task.approved"],
      [["request_changes", "test-writer"], ["approve", "none"]],
      [1],
      true,
      "",
      { implementer: 1, testWriter: 2 },
    ]);
  }, LANE_TIMEOUT);

  // @covers build-stage:INV-004
  it("stops after three red implementer attempts with task.failed cap_exhausted and a single run.failed", async () => {
    const { engine } = await scenario(async (request) => {
      const invocation = invocationOf(request);
      await (invocation.role === "test-writer" ? writeTests(invocation) : writeImplementation(invocation, "export function greet(name: string): string {\n  return name;\n}\n"));
    });

    await engine.waitFor(runEnded, LANE_TIMEOUT);

    expect([
      engine.events.filter((event) => event.type === "task.rework").map((event) => event.payload["attempt"]),
      engine.events.filter((event) => event.type === "task.impl_done").length,
      engine.events.filter((event) => event.type === "task.failed").map((event) => [event.payload["reason"], event.payload["detail"]]),
      engine.events.filter((event) => event.type === "run.failed").map((event) => [event.payload["stage"], event.payload["reason"]]),
      engine.state().tasks["T-001"]?.attempts.implementer,
    ]).toEqual([[2, 3], 3, [["cap_exhausted", "implementer"]], [["build", "cap_exhausted"]], 3]);
  }, LANE_TIMEOUT);

  // @covers build-stage:BEH-016
  it("fails the run once on the first task.failed and drops the other lane's late result", async () => {
    let releaseSecondLane: () => void = () => undefined;
    const secondLaneReleased = new Promise<void>((resolvePromise) => {
      releaseSecondLane = resolvePromise;
    });
    let markSecondLaneStarted: () => void = () => undefined;
    const secondLaneStarted = new Promise<void>((resolvePromise) => {
      markSecondLaneStarted = resolvePromise;
    });
    const design = greeterDesign([aTaskSpec({ id: "T-001" }), aTaskSpec({ id: "T-002", covers: ["greeter:BEH-002"], writes: ["src/b.ts", "tests/b.test.ts"], designRefs: ["M-02"] })], [aModule(), aModule({ id: "M-02", name: "b", covers: ["greeter:BEH-002"], owns: ["src/b.ts"], entry: "src/b.ts" })]);
    const { engine } = await scenario(
      async (request) => {
        const invocation = invocationOf(request);
        if (invocation.taskId === "T-001") {
          await secondLaneStarted;
          await writeHandoff(invocation.handoffPath, { role: "test-writer", attempt: 1, status: "blocked", test_files: [], covers: [], blocked_reason: "no tests glob" });
          return;
        }
        markSecondLaneStarted();
        await secondLaneReleased;
        await writeTests(invocation);
      },
      approveReview,
      design,
      { "T-001": aTask(), "T-002": aTask({ covers: ["greeter:BEH-002"], writes: ["src/b.ts", "tests/b.test.ts"] }) },
    );

    await engine.waitFor(runEnded, LANE_TIMEOUT);
    releaseSecondLane();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));

    expect([
      engine.events.filter((event) => event.type === "task.ready").map((event) => event.payload["taskId"]),
      engine.events.filter((event) => event.type === "run.failed").length,
      engine.events.filter((event) => event.type === "task.tests_written").length,
      eventTypes(engine.events).at(-1),
      engine.state().status,
    ]).toEqual([["T-001", "T-002"], 1, 0, "run.failed", "failed"]);
  }, LANE_TIMEOUT);

  // @covers build-stage:INV-006
  it("runs the test-writers of two independent tasks concurrently", async () => {
    const intervals: Record<string, { start: number; end: number }> = {};
    let markBothRecorded: () => void = () => undefined;
    const bothRecorded = new Promise<void>((resolvePromise) => {
      markBothRecorded = resolvePromise;
    });
    const design = greeterDesign([aTaskSpec({ id: "T-001" }), aTaskSpec({ id: "T-002", covers: ["greeter:BEH-002"], writes: ["src/b.ts", "tests/b.test.ts"], designRefs: [] })]);
    const { engine } = await scenario(
      async (request) => {
        const invocation = invocationOf(request);
        const start = Date.now();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
        intervals[invocation.taskId] = { start, end: Date.now() };
        if (Object.keys(intervals).length === 2) {
          markBothRecorded();
        }
        await writeHandoff(invocation.handoffPath, { role: "test-writer", attempt: 1, status: "blocked", test_files: [], covers: [], blocked_reason: "stop here" });
      },
      approveReview,
      design,
      { "T-001": aTask(), "T-002": aTask({ covers: ["greeter:BEH-002"], writes: ["src/b.ts", "tests/b.test.ts"] }) },
    );

    await bothRecorded;
    await engine.waitFor(hasEvent("task.ready", (payload) => payload["taskId"] === "T-002"), LANE_TIMEOUT);

    const first = intervals["T-001"];
    const second = intervals["T-002"];
    expect([first !== undefined && second !== undefined && first.start < second.end && second.start < first.end, engine.events.filter((event) => event.type === "task.ready").length]).toEqual([true, 2]);
  }, LANE_TIMEOUT);

  // @covers build-stage:BEH-011
  it("re-provisions once when the verifier cannot start the test runner and fails the run with tooling_broken on the second occurrence", async () => {
    const design = greeterDesign();
    const broken: DesignBundle = { ...design, tech: { ...design.tech, tooling: { ...design.tech.tooling, testCmd: "npx sdd-factory-missing-runner-xyz run" } } };
    const { harness, engine } = await scenario(happyLane, approveReview, broken);

    await engine.waitFor(runEnded, LANE_TIMEOUT);

    expect([
      eventTypes(engine.events),
      engine.events.filter((event) => event.type === "task.finding").map((event) => [event.payload["type"], event.payload["origin"]]),
      harness.commands.calls.filter((call) => call.command === "npm").map((call) => call.args),
      engine.events.at(-1)?.payload["reason"],
    ]).toEqual([
      ["task.ready", "task.tests_written", "task.finding", "task.finding", "run.failed"],
      [["TOOLING-BROKEN", "red-check"], ["TOOLING-BROKEN", "red-check"]],
      [["ci"]],
      "tooling_broken",
    ]);
  }, LANE_TIMEOUT);

  it("rejects a TOOLING-BROKEN claim from the implementer when the toolchain works", async () => {
    const { engine, harness } = await scenario(async (request) => {
      const invocation = invocationOf(request);
      if (invocation.role === "test-writer") {
        await writeTests(invocation);
        return;
      }
      await (invocation.attempt === 1 ? writeFinding(invocation, "TOOLING-BROKEN", "npx vitest run: command not found") : writeImplementation(invocation));
    });

    await engine.waitFor(laneEnded, LANE_TIMEOUT);

    expect([
      engine.events.filter((event) => event.type === "task.rework").map((event) => [event.payload["target"], event.payload["attempt"], event.payload["reason"]]),
      harness.commands.calls.filter((call) => call.command === "npm").length,
      eventTypes(engine.events).at(-1),
    ]).toEqual([[["implementer", 2, "claim_rejected"]], 0, "task.approved"]);
  }, LANE_TIMEOUT);
});
