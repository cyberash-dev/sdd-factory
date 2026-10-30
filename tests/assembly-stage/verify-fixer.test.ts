import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { verifyEffect } from "../../src/assembly-stage/application/verify.js";
import type { CommandInvocation, CommandResult } from "../../src/assembly-stage/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import { writeTextAtomic } from "../../src/shared/fs/text.js";
import type { CliRoleOutcome, CliRoleRequest, CliRoleRunner } from "../../src/shared/llm/cli-role-runner.js";
import { baselineSpec, collectingContext, commandLine, failed, fakeCommandRunner, git, initRepo, ok, runState, sddReadyReport, sliceContext, SLUG, taskState, tempDir, tokenEnvelope, vitestReport, writeFiles, type CollectingContext, type FakeCommandRunner } from "./support.js";

const BROKEN_SOURCE = "export const answer: number = 'forty-two';\n";
const REPAIRED_SOURCE = "export const answer: number = 42;\n";

interface FixerScenario {
  readonly root: string;
  readonly productDir: string;
  readonly runner: FakeCommandRunner;
  readonly fixerRequests: readonly CliRoleRequest[];
  readonly context: CollectingContext;
}

interface ScenarioInput {
  readonly tsc: (productDir: string) => Promise<CommandResult>;
  readonly vitest: (productDir: string) => string;
  readonly install?: () => CommandResult;
  readonly fixerWrites: Readonly<Record<string, string>>;
}

function fixerOutcome(): CliRoleOutcome {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    result: { isError: false, costUsd: 0.02, inputTokens: 500, outputTokens: 40, durationMs: 1500, resultText: "edited what the output named", dominantModel: "claude-opus-5-5" },
    toolUses: [],
    stderrTail: "",
    durationMs: 1600,
  };
}

function scriptedFixer(writes: Readonly<Record<string, string>>, requests: CliRoleRequest[]): CliRoleRunner {
  return {
    async run(request) {
      requests.push(request);
      await writeFiles(request.cwd, writes);
      return fixerOutcome();
    },
  };
}

function outputFileOf(invocation: CommandInvocation): string {
  const flag = invocation.argv.find((argument) => argument.startsWith("--outputFile="));
  return flag === undefined ? "" : flag.slice("--outputFile=".length);
}

async function typecheckOf(productDir: string): Promise<CommandResult> {
  const source = await readFile(join(productDir, "src/answer.ts"), "utf8");
  return source === REPAIRED_SOURCE ? ok() : failed(2, "", "src/answer.ts(1,31): error TS2322: Type 'string' is not assignable to type 'number'.");
}

async function runFixerScenario(input: ScenarioInput): Promise<FixerScenario> {
  const root = await tempDir("assembly-fixer");
  const productDir = join(root, "product");
  const baseSha = await initRepo(productDir, "integration", {
    "package.json": '{"name":"todo-cli","version":"0.0.0","private":true}\n',
    "spec/spec.md": baselineSpec(SLUG, "0".repeat(40), "0".repeat(64)),
    "src/answer.ts": BROKEN_SOURCE,
  });
  const runner = fakeCommandRunner(async (invocation) => {
    const line = commandLine(invocation);
    if (line.startsWith("npm ci")) {
      return input.install === undefined ? ok() : input.install();
    }
    if (line.startsWith("npx tsc")) {
      return input.tsc(productDir);
    }
    if (line.startsWith("npx vitest")) {
      const report = input.vitest(productDir);
      await writeTextAtomic(outputFileOf(invocation), report);
      return report.includes('"success":true') ? ok() : failed(1, "", "tests failed");
    }
    if (line.startsWith("npx sdd token")) {
      return ok(tokenEnvelope("b".repeat(64), "a".repeat(40)));
    }
    return line.startsWith("npx sdd ready") ? ok(sddReadyReport([])) : undefined;
  });
  const fixerRequests: CliRoleRequest[] = [];
  const context = collectingContext(runState({ status: "assembling", assemblyRounds: 1, tasks: { "T-001": taskState({ implSha: baseSha }) } }));
  const slice = sliceContext({ root, cliRoles: scriptedFixer(input.fixerWrites, fixerRequests), config: { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, simpleFixes: 2 } } });
  await verifyEffect(runner)({ kind: "assembly.verify", round: 1, taskOrder: ["T-001"] }, context, slice);
  return { root, productDir, runner, fixerRequests, context };
}

function eventsOf(context: CollectingContext): readonly string[] {
  return context.published.map((event) =>
    event.type === "fix.attempted" ? `fix.attempted ${String(event.payload["trigger"])} ${String(event.payload["outcome"])}` : `${event.type} ${String(event.payload["step"] ?? event.payload["target"])} ${String(event.payload["result"] ?? event.payload["reason"])}`,
  );
}

function stepCommands(runner: FakeCommandRunner): readonly string[] {
  return runner.calls.filter((call) => call.argv[0] === "npm" || call.argv[0] === "npx").map((call) => call.argv.slice(0, 3).join(" "));
}

async function reportFrontmatter(productDir: string): Promise<Record<string, unknown>> {
  const report = await readFile(join(productDir, "assembly/report.md"), "utf8");
  const parsed: unknown = YAML.parse(report.split("\n---\n")[0]?.replace(/^---\n/, "") ?? "");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("report frontmatter is not a mapping");
  }
  return { ...parsed };
}

function repairedTypecheck(): ScenarioInput {
  return { tsc: typecheckOf, vitest: () => vitestReport({ passing: ["tests/answer.test.ts"] }), fixerWrites: { "src/answer.ts": REPAIRED_SOURCE } };
}

function neverRepairedTypecheck(): ScenarioInput {
  return { tsc: typecheckOf, vitest: () => vitestReport({ passing: ["tests/answer.test.ts"] }), fixerWrites: { "src/answer.ts": "export const answer: number = 'still a string';\n" } };
}

describe("assembly.verify simple-fixer on a mechanical red step", () => {
  // @covers assembly-stage:DLT-001
  // @covers assembly-stage:INV-001
  it("commits the repaired typecheck on integration as fix assembly round 1 1 authored simple-fixer", async () => {
    const scenario = await runFixerScenario(repairedTypecheck());

    const fixCommit = await git(scenario.productDir, "log", "--format=%an|%s|%H", "--grep=^fix assembly", "integration");

    expect([fixCommit.split("|").slice(0, 2), await git(scenario.productDir, "show", "--format=", "--name-only", fixCommit.split("|")[2] ?? "")]).toEqual([["simple-fixer", "fix assembly round 1 1"], "src/answer.ts"]);
  });

  // @covers assembly-stage:DLT-001
  it("restarts the sequence at install after the fix and runs typecheck, test and sdd ready again without triage", async () => {
    const scenario = await runFixerScenario(repairedTypecheck());

    expect([stepCommands(scenario.runner), eventsOf(scenario.context)]).toEqual([
      ["npm ci --prefer-offline", "npx tsc --noEmit", "npx tsc --noEmit", "npm ci --prefer-offline", "npx tsc --noEmit", "npx vitest run", "npx sdd token", "npx sdd ready"],
      [
        "assembly.verified install green",
        "fix.attempted assembly_typecheck fixed",
        "assembly.verified install green",
        "assembly.verified typecheck green",
        "assembly.verified test green",
        "assembly.verified sdd_ready green",
      ],
    ]);
  });

  // @covers assembly-stage:DLT-001
  it("lists the fix with its round, attempt, trigger, outcome, commit and files in the report frontmatter", async () => {
    const scenario = await runFixerScenario(repairedTypecheck());

    const fixSha = await git(scenario.productDir, "log", "--format=%H", "--grep=^fix assembly", "integration");

    expect((await reportFrontmatter(scenario.productDir))["fixes"]).toEqual([{ round: 1, attempt: 1, trigger: "assembly_typecheck", outcome: "fixed", commit_sha: fixSha, files: ["src/answer.ts"] }]);
  });

  // @covers assembly-stage:DLT-001
  it("lists each fix with its trigger and outcome in the round section of the report body", async () => {
    const scenario = await runFixerScenario(repairedTypecheck());

    const report = await readFile(join(scenario.productDir, "assembly/report.md"), "utf8");

    expect(report).toContain("## Round 1\n\n- merge T-001");
    expect(report.split("## Round 1")[1]).toContain("- fix 1 assembly_typecheck: fixed (src/answer.ts)");
  });

  // @covers assembly-stage:DLT-001
  it("publishes the red typecheck only after two unfixed runs and leaves the integration tree clean", async () => {
    const scenario = await runFixerScenario(neverRepairedTypecheck());

    expect([eventsOf(scenario.context), await git(scenario.productDir, "status", "--porcelain"), await git(scenario.productDir, "log", "-1", "--format=%s")]).toEqual([
      ["assembly.verified install green", "fix.attempted assembly_typecheck unfixed", "fix.attempted assembly_typecheck unfixed", "assembly.verified typecheck red"],
      "",
      "base",
    ]);
  });

  // @covers assembly-stage:DLT-001
  it("records both unfixed runs without a commit in the ledger", async () => {
    const scenario = await runFixerScenario(neverRepairedTypecheck());

    const ledger = JSON.parse(await readFile(join(scenario.root, "run/assembly/ledger.json"), "utf8"));

    expect(ledger.fixes).toEqual([
      { round: 1, attempt: 1, trigger: "assembly_typecheck", outcome: "unfixed", commit_sha: null, files: ["src/answer.ts"] },
      { round: 1, attempt: 2, trigger: "assembly_typecheck", outcome: "unfixed", commit_sha: null, files: [] },
    ]);
  });

  // @covers assembly-stage:DLT-001
  it("never invokes the fixer for a test step with a failed assertion", async () => {
    const scenario = await runFixerScenario({
      tsc: async () => ok(),
      vitest: (productDir) => vitestReport({ failing: [{ file: join(productDir, "tests/answer.test.ts"), name: "answers", message: "expected 41 to be 42" }] }),
      fixerWrites: { "src/answer.ts": REPAIRED_SOURCE },
    });

    expect([scenario.fixerRequests.length, eventsOf(scenario.context)]).toEqual([0, ["assembly.verified install green", "assembly.verified typecheck green", "assembly.verified test red"]]);
  });

  // @covers assembly-stage:DLT-001
  it("invokes the fixer with trigger assembly_load_failure for a test file that fails to load with zero failed tests", async () => {
    const scenario = await runFixerScenario({
      tsc: async () => ok(),
      vitest: (productDir) => JSON.stringify({ success: false, testResults: [{ name: join(productDir, "tests/answer.test.ts"), status: "failed", message: "Cannot find module '../src/missing.js'", assertionResults: [] }] }),
      fixerWrites: { "src/missing.ts": "export const missing = 1;\n" },
    });

    expect(eventsOf(scenario.context).filter((event) => event.startsWith("fix.attempted"))).toEqual(["fix.attempted assembly_load_failure unfixed", "fix.attempted assembly_load_failure unfixed"]);
  });

  // @covers assembly-stage:DLT-001
  it("invokes the fixer with trigger assembly_install for an install failure that is not a network failure", async () => {
    const scenario = await runFixerScenario({ tsc: async () => ok(), vitest: () => vitestReport({ passing: ["x"] }), install: () => failed(1, "npm ERR! Invalid package.json"), fixerWrites: { "package.json": "{}\n" } });

    expect(eventsOf(scenario.context)).toEqual(["fix.attempted assembly_install unfixed", "fix.attempted assembly_install unfixed", "assembly.verified install red"]);
  });

  // @covers assembly-stage:DLT-001
  it("takes the offline fallback without the fixer when install fails on the network", async () => {
    const scenario = await runFixerScenario({ tsc: async () => ok(), vitest: () => vitestReport({ passing: ["x"] }), install: () => failed(1, "npm ERR! code ENOTFOUND registry.npmjs.org"), fixerWrites: {} });

    expect([scenario.fixerRequests.length, stepCommands(scenario.runner), eventsOf(scenario.context)]).toEqual([0, ["npm ci --prefer-offline", "npm ci --offline"], ["assembly.verified install red"]]);
  });
});
