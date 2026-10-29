import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecFileCommandRunner } from "../../src/build-stage/adapters/outbound/exec-file-command-runner.js";
import { argvOf } from "../../src/build-stage/domain/command-line.js";
import { coversMarkersIn } from "../../src/build-stage/domain/covers-markers.js";
import { allTasksApproved, startableTasks } from "../../src/build-stage/domain/task-scheduling.js";
import { handoffRejectionNote, runWithHandoffRetry } from "../../src/build-stage/application/handoff-roundtrip.js";
import { LaneRegistry } from "../../src/build-stage/application/lane-registry.js";
import { coversMarker } from "./support/lanes.js";
import { aTask, buildingState } from "./support/state.js";

describe("command lines", () => {
  it.each([
    ["npx vitest run", ["npx", "vitest", "run"]],
    ['node --test "my dir/x.js"', ["node", "--test", "my dir/x.js"]],
    ["  npx   tsc --noEmit ", ["npx", "tsc", "--noEmit"]],
  ])("splits %j into argv", (line, argv) => {
    expect(argvOf(line)).toEqual(argv);
  });

  it("rejects an empty command line", () => {
    expect(() => argvOf("   ")).toThrow('empty command line: "   "');
  });
});

describe("exec command runner", () => {
  it("reports a missing binary as exit 127 with a command-not-found line instead of rejecting", async () => {
    const result = await createExecFileCommandRunner().run("sdd-factory-no-such-binary", ["--version"], { cwd: tmpdir() });

    expect([result.exitCode, result.stderr]).toEqual([127, "sdd-factory-no-such-binary: command not found (ENOENT)\n"]);
  });

  it("reports a timed-out command as exit 124", async () => {
    const result = await createExecFileCommandRunner().run("sleep", ["2"], { cwd: tmpdir(), timeoutMs: 100 });

    expect([result.exitCode, result.stderr.includes("timed out after 100 ms")]).toEqual([124, true]);
  });
});

describe("covers markers", () => {
  it("collects each id once from line and block comment markers", () => {
    const source = `${coversMarker("greeter:BEH-001")}\nit('a');\n/* @${"covers"} greeter:CTR-002 */\n${coversMarker("greeter:BEH-001")}\n`;

    expect(coversMarkersIn(source)).toEqual(["greeter:BEH-001", "greeter:CTR-002"]);
  });
});

describe("lane scheduling", () => {
  // @covers build-stage:INV-006
  it("starts every independent ready task in the same step, ordered by id", () => {
    const state = buildingState({ "T-002": aTask(), "T-001": aTask(), "T-003": aTask({ dependsOn: ["T-001"] }) });

    expect(startableTasks(state, 4)).toEqual(["T-001", "T-002"]);
  });

  it("starts a dependent task only when every dependency is approved", () => {
    const state = buildingState({ "T-001": aTask({ status: "approved" }), "T-002": aTask({ status: "impl_pending" }), "T-003": aTask({ dependsOn: ["T-001", "T-002"] }), "T-004": aTask({ dependsOn: ["T-001"] }) });

    expect(startableTasks(state, 4)).toEqual(["T-004"]);
  });

  it("never starts a task whose dependency failed", () => {
    const state = buildingState({ "T-001": aTask({ status: "failed" }), "T-002": aTask({ dependsOn: ["T-001"] }) });

    expect(startableTasks(state, 4)).toEqual([]);
  });

  it("bounds the number of simultaneously active lanes by maxParallelLanes", () => {
    const state = buildingState({ "T-001": aTask({ status: "impl_pending" }), "T-002": aTask(), "T-003": aTask(), "T-004": aTask() });

    expect(startableTasks(state, 2)).toEqual(["T-002"]);
  });

  it("reports all tasks approved only when every task is approved and at least one exists", () => {
    expect([
      allTasksApproved(buildingState({})),
      allTasksApproved(buildingState({ "T-001": aTask({ status: "approved" }), "T-002": aTask() })),
      allTasksApproved(buildingState({ "T-001": aTask({ status: "approved" }) })),
    ]).toEqual([false, false, true]);
  });
});

describe("lane registry", () => {
  it("drops a token after its lane is cancelled and every token after cancelAll", () => {
    const registry = new LaneRegistry();
    const before = registry.tokenOf("T-001");
    const other = registry.tokenOf("T-002");

    registry.cancel("T-001");
    const after = registry.tokenOf("T-001");
    const liveness = [registry.isLive(before), registry.isLive(after), registry.isLive(other)];
    registry.cancelAll();

    expect([liveness, registry.isLive(after), registry.isLive(other)]).toEqual([[false, true, true], false, false]);
  });
});

describe("handoff roundtrip", () => {
  // @covers build-stage:BEH-015
  it("re-invokes once with the parse error appended and keeps the malformed file with a .rejected suffix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const handoffPath = join(dir, "handoff.md");
    const messages: string[] = [];
    let invocations = 0;

    const result = await runWithHandoffRetry(
      {
        role: "test-writer",
        handoffPath,
        maxReruns: 1,
        invoke: async (message) => {
          messages.push(message);
          invocations += 1;
          await writeFile(handoffPath, invocations === 1 ? "garbage" : "---\nrole: test-writer\n---\n", "utf8");
          return invocations;
        },
        parse: async () => (invocations === 1 ? { ok: false, error: "missing_frontmatter" } : { ok: true, value: "parsed" }),
      },
      "do the task",
    );

    expect([result, messages[1], (await readdir(dir)).sort()]).toEqual([
      { ok: true, run: 2, parsed: "parsed", reruns: 1 },
      `do the task${handoffRejectionNote(handoffPath, "missing_frontmatter")}`,
      ["handoff.md", "handoff.md.rejected-1"],
    ]);
  });

  it("gives up after the configured re-run with the last error and exactly two invocations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    let invocations = 0;

    const result = await runWithHandoffRetry(
      {
        role: "implementer",
        handoffPath: join(dir, "handoff.md"),
        maxReruns: 1,
        invoke: async () => {
          invocations += 1;
          return invocations;
        },
        parse: async () => ({ ok: false, error: "missing_file" }),
      },
      "m",
    );

    expect([result, invocations]).toEqual([{ ok: false, run: 2, error: "missing_file", reruns: 1 }, 2]);
  });
});
