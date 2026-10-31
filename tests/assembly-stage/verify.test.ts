import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { verifyEffect } from "../../src/assembly-stage/application/verify.js";
import type { CommandInvocation, CommandResult } from "../../src/assembly-stage/ports/outbound/command-runner.js";
import { readTextOrNull, writeTextAtomic } from "../../src/shared/fs/text.js";
import { baselineSpec, collectingContext, commandLine, coversMarker, commitFiles, failed, fakeCommandRunner, git, initRepo, ok, runState, sddReadyReport, sliceContext, SLUG, taskState, tempDir, tokenEnvelope, vitestReport, type CommandScript, type FakeCommandRunner } from "./support.js";

const STALE_SHA = "0".repeat(40);
const STALE_TOKEN = "0".repeat(64);
const FRESH_SHA = "a".repeat(40);
const FRESH_TOKEN = "b".repeat(64);
const PRODUCT_FILES = {
  "package.json": '{"name":"todo-cli","version":"0.0.0","private":true,"scripts":{"test":"node --test tests/"}}\n',
  "tsconfig.json": "{}\n",
  "spec/spec.md": baselineSpec(SLUG, STALE_SHA, STALE_TOKEN),
  "design/tasks.json": "[]\n",
};

interface Fixture {
  readonly root: string;
  readonly productDir: string;
  readonly baseSha: string;
}

const BUILD_PRODUCT_FILES = {
  ...PRODUCT_FILES,
  "package.json": '{"name":"todo-cli","version":"0.0.0","private":true,"scripts":{"test":"node --test tests/","build":"tsc -p tsconfig.build.json"}}\n',
};

async function productRepo(files: Readonly<Record<string, string>> = PRODUCT_FILES): Promise<Fixture> {
  const root = await tempDir("assembly-verify");
  const productDir = join(root, "product");
  const baseSha = await initRepo(productDir, "integration", files);
  return { root, productDir, baseSha };
}

function outputFileOf(invocation: CommandInvocation): string {
  const flag = invocation.argv.find((argument) => argument.startsWith("--outputFile="));
  return flag === undefined ? "" : flag.slice("--outputFile=".length);
}

function allGreen(vitestJson: string, sddJson = sddReadyReport([])): CommandScript {
  return async (invocation) => {
    const line = commandLine(invocation);
    if (line.startsWith("npm ci")) {
      return ok("added 0 packages");
    }
    if (line.startsWith("npx tsc")) {
      return ok();
    }
    if (line.startsWith("npx vitest")) {
      await writeTextAtomic(outputFileOf(invocation), vitestJson);
      return vitestJson.includes('"success":true') ? ok() : failed(1, "", "tests failed");
    }
    if (line.startsWith("npx sdd token")) {
      return ok(tokenEnvelope(FRESH_TOKEN, FRESH_SHA));
    }
    if (line.startsWith("npx sdd ready")) {
      return sddJson.includes('"ok":true') ? ok(sddJson) : failed(1, "", sddJson);
    }
    return undefined;
  };
}

async function runVerify(fixture: Fixture, runner: FakeCommandRunner, tasks: Parameters<typeof runState>[0]["tasks"], taskOrder: readonly string[]) {
  const state = runState({ status: "assembling", assemblyRounds: 1, tasks });
  const context = collectingContext(state);
  const log: string[] = [];
  await verifyEffect(runner)({ kind: "assembly.verify", round: 1, taskOrder }, context, sliceContext({ root: fixture.root, log }));
  return { context, log };
}

function stepsOf(context: { readonly published: readonly { readonly type: string; readonly payload: Readonly<Record<string, unknown>> }[] }): readonly string[] {
  return context.published.map((event) => `${event.type} ${String(event.payload["step"] ?? event.payload["target"])} ${String(event.payload["result"] ?? event.payload["reason"])}`);
}

function withBuild(build: CommandResult, script: CommandScript): CommandScript {
  return (invocation) => (commandLine(invocation) === "npm run build" ? build : script(invocation));
}

function stepCommands(runner: FakeCommandRunner): readonly string[] {
  return runner.calls.filter((call) => call.argv[0] === "npm" || call.argv[0] === "npx").map((call) => call.argv.slice(0, 3).join(" "));
}

describe("assembly.verify straggler merge", () => {
  // @covers assembly-stage:BEH-002
  // @covers assembly-stage:INV-001
  it("skips every task already reachable from the integration head and creates no merge commit", async () => {
    const fixture = await productRepo();
    const first = await commitFiles(fixture.productDir, { "src/a.js": "export const a = 1;\n" }, "T-001");
    const second = await commitFiles(fixture.productDir, { "src/b.js": "export const b = 2;\n" }, "T-002");
    const third = await commitFiles(fixture.productDir, { "src/c.js": "export const c = 3;\n" }, "T-003");
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npm ci") ? failed(1, "EACCES") : undefined));

    await runVerify(fixture, runner, { "T-001": taskState({ implSha: first }), "T-002": taskState({ implSha: second }), "T-003": taskState({ implSha: third }) }, ["T-001", "T-002", "T-003"]);

    const ledger = JSON.parse(await readFile(join(fixture.root, "run", "assembly", "ledger.json"), "utf8"));
    expect([ledger.merges.map((entry: { result: string }) => entry.result), await git(fixture.productDir, "rev-parse", "HEAD"), await git(fixture.productDir, "rev-list", "--count", "HEAD")]).toEqual([
      ["skipped_ancestor", "skipped_ancestor", "skipped_ancestor"],
      third,
      "4",
    ]);
  });

  // @covers assembly-stage:BEH-002
  it("fast-forwards a straggler whose commit descends from the integration head", async () => {
    const fixture = await productRepo();
    const first = await commitFiles(fixture.productDir, { "src/a.js": "export const a = 1;\n" }, "T-001");
    await git(fixture.productDir, "checkout", "-q", "-b", "task/T-002");
    const straggler = await commitFiles(fixture.productDir, { "src/b.js": "export const b = 2;\n" }, "T-002");
    await git(fixture.productDir, "checkout", "-q", "integration");
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npm ci") ? failed(1, "EACCES") : undefined));

    await runVerify(fixture, runner, { "T-001": taskState({ implSha: first }), "T-002": taskState({ implSha: straggler }) }, ["T-001", "T-002"]);

    const ledger = JSON.parse(await readFile(join(fixture.root, "run", "assembly", "ledger.json"), "utf8"));
    expect([ledger.merges.map((entry: { result: string }) => entry.result), await git(fixture.productDir, "rev-parse", "HEAD")]).toEqual([["skipped_ancestor", "fast_forward"], straggler]);
  });

  // @covers assembly-stage:BEH-002
  // @covers assembly-stage:INV-001
  it("creates a merge commit for a diverged straggler whose tree equals the clean merge of both parents", async () => {
    const fixture = await productRepo();
    await git(fixture.productDir, "checkout", "-q", "-b", "task/T-002");
    const straggler = await commitFiles(fixture.productDir, { "src/b.js": "export const b = 2;\n" }, "T-002");
    await git(fixture.productDir, "checkout", "-q", "integration");
    const first = await commitFiles(fixture.productDir, { "src/a.js": "export const a = 1;\n" }, "T-001");
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npm ci") ? failed(1, "EACCES") : undefined));

    await runVerify(fixture, runner, { "T-001": taskState({ implSha: first }), "T-002": taskState({ implSha: straggler }) }, ["T-001", "T-002"]);

    const ledger = JSON.parse(await readFile(join(fixture.root, "run", "assembly", "ledger.json"), "utf8"));
    const expectedTree = await git(fixture.productDir, "merge-tree", "--write-tree", first, straggler);
    expect([ledger.merges.map((entry: { result: string }) => entry.result), await git(fixture.productDir, "rev-parse", "HEAD^{tree}"), await git(fixture.productDir, "rev-list", "--merges", "--count", "HEAD")]).toEqual([
      ["skipped_ancestor", "merged"],
      expectedTree,
      "1",
    ]);
  });

  // @covers assembly-stage:BEH-002
  // @covers assembly-stage:CST-002
  it("aborts a conflicting straggler merge, leaves a clean tree and routes the task to the planner", async () => {
    const fixture = await productRepo();
    await git(fixture.productDir, "checkout", "-q", "-b", "task/T-002");
    const straggler = await commitFiles(fixture.productDir, { "src/shared.js": "export const shared = 'from T-002';\n" }, "T-002");
    await git(fixture.productDir, "checkout", "-q", "integration");
    const first = await commitFiles(fixture.productDir, { "src/shared.js": "export const shared = 'from T-001';\n" }, "T-001");
    const runner = fakeCommandRunner(() => undefined);

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: first }), "T-002": taskState({ implSha: straggler }) }, ["T-001", "T-002"]);

    expect([context.published, await git(fixture.productDir, "status", "--porcelain"), await readFile(join(fixture.productDir, "src/shared.js"), "utf8"), await git(fixture.productDir, "rev-parse", "HEAD")]).toEqual([
      [{ type: "assembly.triaged", producer: "assembler", payload: { taskId: "T-002", target: "planner", reason: "write_set_conflict" } }],
      "",
      "export const shared = 'from T-001';\n",
      first,
    ]);
  });

  // @covers assembly-stage:BEH-002
  it("fails fast on a task whose implSha is missing from the repository", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(() => undefined);

    await expect(runVerify(fixture, runner, { "T-001": taskState({ implSha: "0123456789abcdef0123456789abcdef01234567" }) }, ["T-001"])).rejects.toThrow("missing_commit: T-001");
  });
});

describe("assembly.verify verification sequence", () => {
  // @covers assembly-stage:BEH-003
  // @covers assembly-stage:CST-003
  it("runs install, typecheck, test and sdd ready in order and commits the report on integration when all are green", async () => {
    const fixture = await productRepo();
    const first = await commitFiles(fixture.productDir, { "tests/a.test.mjs": coversMarker("todo:BEH-001") }, "T-001");
    const runner = fakeCommandRunner(allGreen(vitestReport({ passing: [join(fixture.productDir, "tests/a.test.mjs")] })));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: first }) }, ["T-001"]);

    const head = await git(fixture.productDir, "log", "-1", "--format=%s");
    expect([stepsOf(context), runner.calls.filter((call) => call.argv[0] !== "git").map(commandLine), head, await git(fixture.productDir, "show", "--stat", "--format=", "HEAD")]).toEqual([
      ["assembly.verified install green", "assembly.verified typecheck green", "assembly.verified test green", "assembly.verified sdd_ready green"],
      ["npm ci --prefer-offline --no-audit --no-fund", "npx tsc --noEmit", `npx vitest run --reporter=json --outputFile=${join(fixture.root, "run/handoffs/assembly/round-1/vitest.json")}`, "npx sdd token --format=json", "npx sdd ready --format=json"],
      "assembly report round 1",
      expect.stringContaining("assembly/report.md"),
    ]);
  });

  // @covers assembly-stage:BEH-003
  it("stops after a red install and emits one red event", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npm ci") ? failed(1, "npm ERR! missing: left-pad") : undefined));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([stepsOf(context), runner.calls.filter((call) => call.argv[0] !== "git").map(commandLine)]).toEqual([["assembly.verified install red"], ["npm ci --prefer-offline --no-audit --no-fund"]]);
  });

  // @covers assembly-stage:BEH-003
  it("stops after a red typecheck without running the tests", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(async (invocation) => {
      const line = commandLine(invocation);
      return line.startsWith("npm ci") ? ok() : line.startsWith("npx tsc") ? failed(2, "", "src/a.ts(1,1): error TS2304") : undefined;
    });

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    const evidence = await readFile(join(fixture.root, "run/handoffs/assembly/round-1/typecheck.log"), "utf8");
    expect([stepsOf(context), runner.calls.filter((call) => call.argv[0] === "npx").length, evidence]).toEqual([
      ["assembly.verified install green", "assembly.verified typecheck red"],
      1,
      "--- stdout ---\nsrc/a.ts(1,1): error TS2304\n--- stderr ---\n\n",
    ]);
  });

  // @covers assembly-stage:BEH-003
  it("reports the covers markers of both failing test files and skips sdd ready", async () => {
    const fixture = await productRepo();
    const first = await commitFiles(fixture.productDir, { "tests/cli/parse.test.mjs": coversMarker("todo:CTR-001") + coversMarker("todo:BEH-001"), "tests/store/save.test.mjs": coversMarker("todo:BEH-002"), "tests/ok.test.mjs": coversMarker("todo:BEH-003") }, "T-001");
    const report = vitestReport({
      failing: [
        { file: join(fixture.productDir, "tests/cli/parse.test.mjs"), name: "parses flags", message: "expected 1 to be 2" },
        { file: join(fixture.productDir, "tests/store/save.test.mjs"), name: "saves", message: "ENOENT" },
      ],
      passing: [join(fixture.productDir, "tests/ok.test.mjs")],
    });
    const runner = fakeCommandRunner(allGreen(report));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: first }) }, ["T-001"]);

    const ledger = JSON.parse(await readFile(join(fixture.root, "run", "assembly", "ledger.json"), "utf8"));
    expect([context.published.at(-1)?.payload, runner.calls.some((call) => commandLine(call).startsWith("npx sdd")), ledger.failing_tests]).toEqual([
      { result: "red", step: "test", evidencePath: join(fixture.root, "run/handoffs/assembly/round-1/vitest.json"), failingCovers: ["todo:CTR-001", "todo:BEH-001", "todo:BEH-002"] },
      false,
      [
        { round: 1, file: "tests/cli/parse.test.mjs", name: "parses flags", message: "expected 1 to be 2" },
        { round: 1, file: "tests/store/save.test.mjs", name: "saves", message: "ENOENT" },
      ],
    ]);
  });

  // @covers assembly-stage:BEH-003
  it("treats a vitest exit 0 whose report shows a failed suite as red", async () => {
    const fixture = await productRepo();
    const report = vitestReport({ failing: [{ file: join(fixture.productDir, "tests/broken.test.mjs"), name: "(suite)", message: "Cannot find module" }] });
    const runner = fakeCommandRunner(async (invocation) => {
      const line = commandLine(invocation);
      if (line.startsWith("npx vitest")) {
        await writeTextAtomic(outputFileOf(invocation), report);
        return ok();
      }
      return line.startsWith("npm ci") || line.startsWith("npx tsc") ? ok() : undefined;
    });

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect(stepsOf(context).at(-1)).toBe("assembly.verified test red");
  });

  // @covers assembly-stage:BEH-003
  // @covers assembly-stage:CST-003
  it("reports the uncovered id on a red sdd ready and commits no report", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(allGreen(vitestReport({ passing: ["x"] }), sddReadyReport([{ kind: "uncovered", id: "todo:BEH-002", file: "spec/spec.md" }])));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([context.published.at(-1)?.payload, await git(fixture.productDir, "log", "-1", "--format=%s")]).toEqual([
      { result: "red", step: "sdd_ready", evidencePath: join(fixture.root, "run/handoffs/assembly/round-1/sdd_ready.json"), failingCovers: ["todo:BEH-002"] },
      "spec: baseline refresh",
    ]);
  });

  // @covers assembly-stage:BEH-003
  it("refreshes the baseline block and commits spec/spec.md before running sdd ready", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(allGreen(vitestReport({ passing: ["x"] })));

    await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    const spec = await readFile(join(fixture.productDir, "spec/spec.md"), "utf8");
    const commands = runner.calls.map(commandLine).filter((line) => line.startsWith("npx sdd") || line.startsWith("git add") || line.startsWith("git commit"));
    expect([spec.includes(`    reference: ${FRESH_SHA}`), spec.includes(`freshness_token: ${FRESH_TOKEN}`), spec.includes(`baseline_commit_sha: ${FRESH_SHA}`), spec.includes(STALE_TOKEN), commands.slice(0, 4), await git(fixture.productDir, "log", "-2", "--format=%s")]).toEqual([
      true,
      true,
      true,
      false,
      ["npx sdd token --format=json", "git add -- spec/spec.md", "git commit -m spec: baseline refresh -- spec/spec.md", "npx sdd ready --format=json"],
      "assembly report round 1\nspec: baseline refresh",
    ]);
  });

  // @covers assembly-stage:BEH-003
  it("commits nothing when the baseline block is already fresh", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npx sdd token") ? ok(tokenEnvelope(STALE_TOKEN, STALE_SHA)) : allGreen(vitestReport({ passing: ["x"] }), sddReadyReport([{ kind: "uncovered", id: "todo:BEH-001" }]))(invocation)));

    await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([runner.calls.map(commandLine).filter((line) => line.startsWith("git commit")), await git(fixture.productDir, "rev-parse", "HEAD")]).toEqual([[], fixture.baseSha]);
  });

  // @covers assembly-stage:BEH-003
  it("fails fast when the discovery scope is dirty at token time", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npx sdd token") ? failed(1, "", JSON.stringify({ format_version: 1, ok: false, reason: "baseline-dirty", dirty_paths: ["src/"] })) : allGreen(vitestReport({ passing: ["x"] }))(invocation)));

    await expect(runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"])).rejects.toThrow("baseline_refresh_failed: baseline-dirty");
  });

  // @covers assembly-stage:EXT-001
  it("retries npm ci offline once after a network failure and reports install green when the retry succeeds", async () => {
    const fixture = await productRepo();
    let installs = 0;
    const runner = fakeCommandRunner(async (invocation) => {
      const line = commandLine(invocation);
      if (line.startsWith("npm ci")) {
        installs += 1;
        return installs === 1 ? failed(1, "npm ERR! code ENOTFOUND registry.npmjs.org") : ok();
      }
      return line.startsWith("npx tsc") ? failed(1, "", "error") : undefined;
    });

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([runner.calls.filter((call) => call.argv[0] === "npm").map(commandLine), stepsOf(context)[0]]).toEqual([
      ["npm ci --prefer-offline --no-audit --no-fund", "npm ci --offline --no-audit --no-fund"],
      "assembly.verified install green",
    ]);
  });

  // @covers assembly-stage:EXT-001
  it("emits exactly one red install event when the online and the offline install both fail", async () => {
    const fixture = await productRepo();
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npm ci") ? failed(1, "npm ERR! code ECONNRESET") : undefined));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([runner.calls.filter((call) => call.argv[0] === "npm").length, stepsOf(context)]).toEqual([2, ["assembly.verified install red"]]);
  });

  // @covers assembly-stage:BEH-003
  it("redacts secret environment values from the captured command output", async () => {
    const fixture = await productRepo();
    process.env["ASSEMBLY_TEST_TOKEN"] = "hunter2hunter2";
    const runner = fakeCommandRunner(async (invocation) => (commandLine(invocation).startsWith("npm ci") ? failed(1, "auth failed with hunter2hunter2") : undefined));

    await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    delete process.env["ASSEMBLY_TEST_TOKEN"];
    expect(await readFile(join(fixture.root, "run/handoffs/assembly/round-1/install.log"), "utf8")).toBe("--- stdout ---\n\n--- stderr ---\nauth failed with [REDACTED]\n");
  });
});

describe("assembly.verify build step", () => {
  // @covers assembly-stage:DLT-005
  // @covers assembly-stage:BEH-003
  it("runs npm run build after the typecheck and before the tests when package.json defines a build script", async () => {
    const fixture = await productRepo(BUILD_PRODUCT_FILES);
    const runner = fakeCommandRunner(withBuild(ok(), allGreen(vitestReport({ passing: ["x"] }))));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([stepCommands(runner), stepsOf(context)]).toEqual([
      ["npm ci --prefer-offline", "npx tsc --noEmit", "npm run build", "npx vitest run", "npx sdd token", "npx sdd ready"],
      ["assembly.verified install green", "assembly.verified typecheck green", "assembly.verified build green", "assembly.verified test green", "assembly.verified sdd_ready green"],
    ]);
  });

  // @covers assembly-stage:DLT-005
  // @covers assembly-stage:CTR-001
  it("lists the build step between typecheck and test in the verification entries of the committed report", async () => {
    const fixture = await productRepo(BUILD_PRODUCT_FILES);
    const runner = fakeCommandRunner(withBuild(ok(), allGreen(vitestReport({ passing: ["x"] }))));

    await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    const report = await git(fixture.productDir, "show", "integration:assembly/report.md");
    const frontmatter: unknown = YAML.parse(report.split("\n---\n")[0]?.replace(/^---\n/, "") ?? "");
    expect(frontmatter).toMatchObject({
      verification: [
        { step: "install" },
        { step: "typecheck" },
        { round: 1, step: "build", argv: ["npm", "run", "build"], exit_code: 0, result: "green", evidence_path: join(fixture.root, "run/handoffs/assembly/round-1/build.log") },
        { step: "test" },
        { step: "sdd_ready" },
      ],
    });
  });

  // @covers assembly-stage:DLT-005
  // @covers assembly-stage:BEH-003
  it("stops after a red build with the captured build output and never runs the tests", async () => {
    const fixture = await productRepo(BUILD_PRODUCT_FILES);
    const runner = fakeCommandRunner(withBuild(failed(2, "", "src/index.ts(3,7): error TS2322"), allGreen(vitestReport({ passing: ["x"] }))));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    const evidencePath = join(fixture.root, "run/handoffs/assembly/round-1/build.log");
    expect([context.published.at(-1)?.payload, stepCommands(runner).some((command) => command.startsWith("npx vitest")), await readTextOrNull(evidencePath)]).toEqual([
      { result: "red", step: "build", evidencePath, failingCovers: [] },
      false,
      "--- stdout ---\nsrc/index.ts(3,7): error TS2322\n--- stderr ---\n\n",
    ]);
  });

  // @covers assembly-stage:DLT-005
  // @covers assembly-stage:DLT-006
  it("runs no build step for a product without a build script whose source spec names no npm command", async () => {
    const fixture = await productRepo();
    await writeTextAtomic(join(fixture.root, "spec.md"), "# todo\n\nA CLI that counts its arguments.\n");
    const runner = fakeCommandRunner(withBuild(ok(), allGreen(vitestReport({ passing: ["x"] }))));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([stepCommands(runner).filter((command) => command.startsWith("npm ")), stepsOf(context)]).toEqual([
      ["npm ci --prefer-offline"],
      ["assembly.verified install green", "assembly.verified typecheck green", "assembly.verified test green", "assembly.verified sdd_ready green"],
    ]);
  });

  // @covers assembly-stage:DLT-006
  // @covers assembly-stage:BEH-003
  it("makes the build step red without running the build when the source spec names a script package.json lacks", async () => {
    const fixture = await productRepo(BUILD_PRODUCT_FILES);
    await writeTextAtomic(join(fixture.root, "spec.md"), "- Start it with `npm start` after `npm run build`.\n");
    const runner = fakeCommandRunner(withBuild(ok(), allGreen(vitestReport({ passing: ["x"] }))));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    const evidenceDir = join(fixture.root, "run/handoffs/assembly/round-1");
    expect([context.published.at(-1)?.payload, stepCommands(runner).includes("npm run build"), await readTextOrNull(join(evidenceDir, "npm_scripts.json")), await readTextOrNull(join(evidenceDir, "build.log"))]).toEqual([
      { result: "red", step: "build", evidencePath: join(evidenceDir, "npm_scripts.json"), failingCovers: [] },
      false,
      '{"named":["build","start"],"missing":["start"]}\n',
      "--- stdout ---\nmissing npm scripts named by the spec: start\n--- stderr ---\n\n",
    ]);
  });

  // @covers assembly-stage:DLT-006
  it("runs npm run build when package.json defines every script the source spec names", async () => {
    const fixture = await productRepo({ ...PRODUCT_FILES, "package.json": '{"name":"todo-cli","private":true,"scripts":{"start":"node dist/index.js","build":"tsc"}}\n' });
    await writeTextAtomic(join(fixture.root, "spec.md"), "- Start it with `npm start` after `npm run build`.\n");
    const runner = fakeCommandRunner(withBuild(ok(), allGreen(vitestReport({ passing: ["x"] }))));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([stepCommands(runner).includes("npm run build"), stepsOf(context)]).toEqual([
      true,
      ["assembly.verified install green", "assembly.verified typecheck green", "assembly.verified build green", "assembly.verified test green", "assembly.verified sdd_ready green"],
    ]);
  });

  // @covers assembly-stage:DLT-006
  it("runs the scripts check as a green build step without a build command for a product without scripts.build", async () => {
    const fixture = await productRepo({ ...PRODUCT_FILES, "package.json": '{"name":"todo-cli","private":true,"scripts":{"start":"node src/index.js"}}\n' });
    await writeTextAtomic(join(fixture.root, "spec.md"), "- Start it with `npm start`.\n");
    const runner = fakeCommandRunner(withBuild(ok(), allGreen(vitestReport({ passing: ["x"] }))));

    const { context } = await runVerify(fixture, runner, { "T-001": taskState({ implSha: fixture.baseSha }) }, ["T-001"]);

    expect([stepCommands(runner).filter((command) => command.startsWith("npm ")), stepsOf(context)]).toEqual([
      ["npm ci --prefer-offline"],
      ["assembly.verified install green", "assembly.verified typecheck green", "assembly.verified build green", "assembly.verified test green", "assembly.verified sdd_ready green"],
    ]);
  });
});
