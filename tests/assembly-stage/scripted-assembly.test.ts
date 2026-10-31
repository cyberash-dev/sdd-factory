import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeEvent, integrationHead, scriptedAssembly } from "./scripted-harness.js";
import { git, scriptedApiRoles, SLUG, vitestReport } from "./support.js";

const ALL_PASS = (productDir: string) => vitestReport({ passing: [join(productDir, "tests/cli/parse.test.mjs"), join(productDir, "tests/store/save.test.mjs"), join(productDir, "tests/api/get.test.mjs")] });
const CLI_FAILS = (productDir: string) =>
  vitestReport({ failing: [{ file: join(productDir, "tests/cli/parse.test.mjs"), name: "parses", message: "signature changed by T-002" }], passing: [join(productDir, "tests/store/save.test.mjs"), join(productDir, "tests/api/get.test.mjs")] });

describe("scripted assembly through the run engine", () => {
  // @covers assembly-stage:SCN-001
  // @covers assembly-stage:INV-003
  it("runs a green assembly end-to-end and publishes after the four green steps", async () => {
    const run = await scriptedAssembly({ vitest: (_, productDir) => ALL_PASS(productDir) });

    const hidden = join(run.teamDir, "hidden", SLUG);
    const published = run.trace.at(-1);
    expect([run.trace.map(describeEvent), published?.payload["commitSha"], await git(run.productDir, "log", "-1", "--format=%s"), await readFile(join(hidden, "assembly/report.md"), "utf8")]).toEqual([
      ["task.approved T-003", "assembly.started", "assembly.verified install green", "assembly.verified typecheck green", "assembly.verified test green", "assembly.verified sdd_ready green", "run.published"],
      await git(run.teamDir, "rev-parse", "HEAD"),
      "assembly report round 1",
      await readFile(join(run.productDir, "assembly/report.md"), "utf8"),
    ]);
  });

  // @covers assembly-stage:SCN-002
  // @covers assembly-stage:BEH-004
  it("fixes one attributed failing test within one rework round without invoking triage and publishes the fixed tree", async () => {
    const apiRoles = scriptedApiRoles(async () => null);
    const run = await scriptedAssembly({ vitest: (round, productDir) => (round === 1 ? CLI_FAILS(productDir) : ALL_PASS(productDir)), apiRoles });

    const fixed = await readFile(join(run.teamDir, "hidden", SLUG, "src/cli/parse.js"), "utf8");
    expect([run.trace.slice(1).map(describeEvent), apiRoles.requests.length, fixed.includes("fixed in rework of T-001"), run.trace[4]?.payload["failingCovers"]]).toEqual([
      [
        "assembly.started",
        "assembly.verified install green",
        "assembly.verified typecheck green",
        "assembly.verified test red",
        "assembly.rework T-001 implementer 1",
        "task.rework T-001 implementer assembly_red",
        "task.verified green T-001",
        "task.reviewed T-001 none",
        "task.approved T-001",
        "assembly.started",
        "assembly.verified install green",
        "assembly.verified typecheck green",
        "assembly.verified test green",
        "assembly.verified sdd_ready green",
        "run.published",
      ],
      0,
      true,
      ["todo:CTR-001"],
    ]);
  });

  // @covers assembly-stage:INV-004
  // @covers assembly-stage:BEH-007
  it("starts exactly cap rounds on a persistent failure and then fails with cap_exhausted", async () => {
    const run = await scriptedAssembly({ vitest: (_, productDir) => CLI_FAILS(productDir) });

    expect([run.trace.filter((event) => event.type === "assembly.started").length, run.trace.map(describeEvent).at(-1), run.trace.filter((event) => event.type === "assembly.rework").length]).toEqual([2, "run.failed assembly cap_exhausted", 1]);
  });

  // @covers assembly-stage:BEH-005
  it("invokes triage exactly once for a typecheck failure and follows its route", async () => {
    const apiRoles = scriptedApiRoles(async () => "---\nrole: triage\nattempt: 1\nstatus: complete\nroute:\n  task_id: T-001\n  target: implementer\n  reason: compile error in src/cli/parse.js\n---\n");
    const run = await scriptedAssembly({ vitest: (_, productDir) => ALL_PASS(productDir), apiRoles, tsc: (attempt) => (attempt === 1 ? { exitCode: 2, stdout: "src/cli/parse.js(1,1): error TS1", stderr: "", durationMs: 1, timedOut: false } : { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false }) });

    expect([apiRoles.requests.length, run.trace.map(describeEvent).slice(2, 7), run.engine.state.status]).toEqual([
      1,
      ["assembly.verified install green", "assembly.verified typecheck red", "assembly.triaged T-001 implementer compile error in src/cli/parse.js", "assembly.rework T-001 implementer 1", "task.rework T-001 implementer triage"],
      "published",
    ]);
  });

  // @covers assembly-stage:DLT-006
  it("routes a script the source spec names but no task's package.json defines through the build step to triage", async () => {
    const apiRoles = scriptedApiRoles(async () => "---\nrole: triage\nattempt: 1\nstatus: complete\nroute:\n  task_id: T-001\n  target: implementer\n  reason: add the start script\n---\n");
    const run = await scriptedAssembly({ vitest: (_, productDir) => ALL_PASS(productDir), apiRoles, sourceSpec: "- Start it with `npm start`.\n" });

    expect([apiRoles.requests.length, run.trace.map(describeEvent).slice(2, 8)]).toEqual([
      1,
      ["assembly.verified install green", "assembly.verified typecheck green", "assembly.verified build red", "assembly.triaged T-001 implementer add the start script", "assembly.rework T-001 implementer 1", "task.rework T-001 implementer triage"],
    ]);
  });

  // @covers assembly-stage:INV-003
  it("publishes the tree of the head the final green round verified", async () => {
    const run = await scriptedAssembly({ vitest: (round, productDir) => (round === 1 ? CLI_FAILS(productDir) : ALL_PASS(productDir)) });

    const ledger = JSON.parse(await readFile(join(run.root, "run/assembly/ledger.json"), "utf8"));
    const lastRoundSteps = run.trace.filter((event) => event.type === "assembly.verified" && event.seq > ([...run.trace].reverse().find((candidate) => candidate.type === "assembly.started")?.seq ?? 0));
    expect([ledger.verified_head, lastRoundSteps.map((event) => event.payload["result"]), lastRoundSteps.every((event) => event.seq < (run.trace.at(-1)?.seq ?? 0))]).toEqual([await integrationHead(run.productDir), ["green", "green", "green", "green"], true]);
  });
});
