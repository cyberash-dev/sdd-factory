import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAssemblySlice } from "../../src/assembly-stage/index.js";
import { createBuildStageSlice } from "../../src/build-stage/index.js";
import { createDesignStageSlice } from "../../src/design-stage/index.js";
import { ExecCommandRunner } from "../../src/factory/adapters/outbound/exec-command-runner.js";
import { startRun } from "../../src/factory/application/compose.js";
import type { CommandRunner } from "../../src/factory/ports/outbound/command-runner.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import type { ApiRoleRequest, ApiRoleRunner } from "../../src/shared/llm/api-role-runner.js";
import type { CliRoleRequest, CliRoleRunner } from "../../src/shared/llm/cli-role-runner.js";
import { createSpecStageSlice } from "../../src/spec-stage/index.js";
import { createTraceSlice } from "../../src/trace/index.js";
import { fakeCommandRunner, initRepo, sddReadyReport, tokenEnvelope } from "../assembly-stage/support.js";
import { cliOutcome, invokeTool, reviewFrontmatter, writeHandoff } from "../build-stage/support/runners.js";
import { REPO_ROOT } from "../build-stage/support/product.js";
import { ARCHITECT_HANDOFF_LINES, DEFAULT_RECORDS, handoffPathIn, handoffText, PLANNER_HANDOFF_LINES, readVia, recordsJson, tasksJsonText, techMdText, VALID_TASKS, VERIFICATION_HANDOFF_LINES, verificationMdText, writeVia } from "../design-stage/harness.js";
import { analystHandoff, criticHandoff, gaReview } from "../spec-stage/harness.js";

const SLUG = "todo-cli";
const TOKEN = tokenEnvelope("ab".repeat(32), "cd".repeat(20));

function record(lines: readonly string[]): string {
  return ["```yaml", "---", ...lines, "---", "```"].join("\n");
}

const SPEC_RECORDS: Readonly<Record<string, string>> = {
  "## 5. Surfaces": record([`id: ${SLUG}:SUR-001`, "type: Surface", "lifecycle: {status: proposed}", `partition_id: ${SLUG}`, "name: todo", 'version: "0.1.0"', "boundary_type: cli", `members: [${SLUG}:CTR-001]`, "consumer_compat_policy: semver_per_surface"]),
  "## 6. Requirements": record([`id: ${SLUG}:BEH-002`, "type: Behavior", "lifecycle: {status: proposed}", `partition_id: ${SLUG}`, "title: counts arguments", `surface_ref: ${SLUG}:SUR-001`, "given: any argv", "when: the user runs todo", "then: exit code equals the argument count", "negative_cases: [none]", "applicability: {invariant_to_all_axes: true}", "concurrency_model: {actor_concurrency: single, read_consistency: strong, idempotency: none, time_source: none}", "data_scope: not_applicable", `policy_refs: [${SLUG}:POL-001]`, "test_obligation: {predicate: argv count, test_template: unit, boundary_classes: [empty, one], failure_scenarios: [wrong count]}"]),
  "## 7. Data contracts": record([`id: ${SLUG}:CTR-001`, "type: Contract", "lifecycle: {status: proposed}", `partition_id: ${SLUG}`, "title: todo argv", `surface_ref: ${SLUG}:SUR-001`, "schema: {argv: list}", "preconditions: [none]", "postconditions: [exit code is the argument count]", "external_identifiers: [todo]", "compatibility_rules: [none]", "error_taxonomy: [exit 2 usage]", "applicability: {invariant_to_all_axes: true}", "concurrency_model: {actor_concurrency: single, read_consistency: strong, idempotency: none, time_source: none}", "data_scope: not_applicable", `policy_refs: [${SLUG}:POL-001]`, "test_obligation: {predicate: argv accepted, test_template: unit, boundary_classes: [empty], failure_scenarios: [crash]}"]),
  "## 12. Policies": record([`id: ${SLUG}:POL-001`, "type: Policy", "lifecycle: {status: proposed}", `partition_id: ${SLUG}`, "title: stable exit codes", "policy_kind: error_reporting", "applicability: {applies_to: every contract}", "predicate: exit codes are stable", "negative_test_obligations: [unknown flag exits 2]", "test_obligation: {predicate: codes stable, test_template: unit, boundary_classes: [unknown flag], failure_scenarios: [crash]}"]),
  "## 13. Constraints": record([`id: ${SLUG}:CST-001`, "type: Constraint", "lifecycle: {status: proposed}", `partition_id: ${SLUG}`, "constraint: TypeScript on node 22", "rationale: the track requires it", "test_obligation: {predicate: engines node 22, test_template: contract, boundary_classes: [package.json], failure_scenarios: [missing engines]}"]),
};

function withRecords(skeleton: string): string {
  return Object.entries(SPEC_RECORDS).reduce((text, [heading, body]) => text.replace(`${heading}\n\nnone`, `${heading}\n\n${body}`), skeleton);
}

function pathIn(message: string, suffix: string): string {
  const match = new RegExp(`(\\S+${suffix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")})`).exec(message);
  if (match?.[1] === undefined) {
    throw new Error(`message names no ${suffix}`);
  }
  return match[1].replace(/^[`'"(]+|[`'",.)]+$/g, "");
}

const LANE_SOURCES: Readonly<Record<string, { readonly test: readonly [string, string]; readonly impl: readonly [string, string]; readonly covers: readonly string[] }>> = {
  "T-001": {
    test: ["tests/cli/parse.test.ts", `import { expect, it } from "vitest";\nimport { parseArgs } from "../../src/cli/index.js";\n\n// @${"covers"} ${SLUG}:CTR-001\n// @${"covers"} ${SLUG}:BEH-002\nit("counts the arguments", () => {\n  expect(parseArgs(["a", "b"])).toBe(2);\n});\n`],
    impl: ["src/cli/index.ts", "export function parseArgs(argv: readonly string[]): number {\n  return argv.length;\n}\n"],
    covers: [`${SLUG}:CTR-001`, `${SLUG}:BEH-002`],
  },
  "T-002": {
    test: ["tests/e2e/main.test.ts", `import { expect, it } from "vitest";\nimport { main } from "../../src/index.js";\n\n// @${"covers"} ${SLUG}:CST-001\nit("exits zero", async () => {\n  expect(await main([])).toBe(0);\n});\n`],
    impl: ["src/index.ts", 'import { parseArgs } from "./cli/index.js";\n\nexport async function main(argv: readonly string[]): Promise<number> {\n  parseArgs(argv);\n  return 0;\n}\n'],
    covers: [`${SLUG}:CST-001`],
  },
};

function laneRoles(): CliRoleRunner {
  return {
    async run(request: CliRoleRequest) {
      const match = /handoff to `([^`]+\/tasks\/(T-\d{3})\/(test-writer|implementer)-(\d+)\/handoff\.md)`/.exec(request.prompt);
      if (match === null || match[1] === undefined || match[2] === undefined) {
        throw new Error("lane prompt names no handoff path");
      }
      const [, handoffPath, taskId, role, attemptText] = match;
      const sources = LANE_SOURCES[taskId];
      if (sources === undefined) {
        throw new Error(`no scripted lane for ${taskId}`);
      }
      const attempt = Number(attemptText);
      const [path, content] = role === "test-writer" ? sources.test : sources.impl;
      await mkdir(join(request.cwd, path, ".."), { recursive: true });
      await writeFile(join(request.cwd, path), content, "utf8");
      await writeHandoff(handoffPath, role === "test-writer" ? { role, attempt, status: "complete", test_files: [path], covers: sources.covers, blocked_reason: "" } : { role, attempt, status: "complete", changed_files: [path] });
      return cliOutcome();
    },
  };
}

async function writeReview(request: ApiRoleRequest): Promise<void> {
  const attempt = Number((request.message.match(/attempt (\d+), mode/) ?? [])[1] ?? "1");
  const implSha = (request.message.match(/Reviewed commit: ([0-9a-f]{40})/) ?? [])[1] ?? null;
  const taskId = (request.message.match(/T-\d{3}/) ?? [])[0] ?? "T-001";
  const text = `---\n${JSON.stringify(reviewFrontmatter({ attempt, task_id: taskId, impl_sha: implSha, mode: "review" }))}\n---\n## Scope checked\n\n## Spec conformance\n\n## Findings\n\n## Verdict rationale\n`;
  await invokeTool(request, "write_file", { path: `reviews/${taskId}.md`, content: text });
  await invokeTool(request, "write_file", { path: `.handoff/reviewer-${attempt}.md`, content: text });
}

function apiRoles(): ApiRoleRunner {
  const usage = { model: "fake", inputTokens: 100, outputTokens: 10, costUsd: 0.01, inferenceCount: 1, durationMs: 5, answer: "done" };
  return {
    async run(request: ApiRoleRequest) {
      switch (request.role) {
        case "spec-analyst": {
          await writeVia(request, "spec/spec.md", withRecords(await readVia(request, "spec/spec.md")));
          await writeVia(request, pathIn(request.message, "/handoffs/spec-analyst/handoff.md"), analystHandoff(1));
          break;
        }
        case "spec-critic": {
          await writeVia(request, "spec/review/ga.md", gaReview(1, "accept", ""));
          await writeVia(request, pathIn(request.message, "/handoffs/spec-critic/handoff.md"), criticHandoff(1, "accept"));
          break;
        }
        case "architect":
          await writeVia(request, "design/tech.md", techMdText());
          await writeVia(request, handoffPathIn(request), handoffText("architect", 1, ARCHITECT_HANDOFF_LINES));
          break;
        case "verification-designer":
          await writeVia(request, "design/verification.md", verificationMdText([`${SLUG}:CTR-001`, `${SLUG}:BEH-002`, `${SLUG}:CST-001`, `${SLUG}:POL-001`]));
          await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
          break;
        case "planner":
          await writeVia(request, "design/tasks.json", tasksJsonText(VALID_TASKS));
          await writeVia(request, handoffPathIn(request), handoffText("planner", 1, PLANNER_HANDOFF_LINES));
          break;
        case "reviewer":
          await writeReview(request);
          break;
        default:
          throw new Error(`unexpected role ${request.role}`);
      }
      return usage;
    },
  };
}

function factoryCommands(productDir: string): CommandRunner {
  const real = new ExecCommandRunner();
  return {
    async run(command, args, options) {
      if (command === "npm") {
        await symlink(join(REPO_ROOT, "node_modules"), join(productDir, "node_modules"), "dir");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === "npx" && args[0] === "sdd") {
        return { exitCode: 0, stdout: TOKEN, stderr: "" };
      }
      return real.run(command, args, options);
    },
  };
}

const LINT_OK = JSON.stringify({ format_version: 1, ok: true, error_count: 0, warn_count: 0, diagnostics: [] });

async function listFiles(dir: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`])));
  return nested.flat().sort();
}

describe("the whole factory on a scripted spec", () => {
  // @covers factory:INV-001
  // @covers factory:BEH-004
  it("drafts, designs, builds two dependent tasks in lanes, assembles and publishes hidden/<slug>/ without any human step", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "pipeline-")), "team");
    await initRepo(root, "main", { "README.md": "team\n" });
    await symlink(join(REPO_ROOT, "prompts"), join(root, "prompts"), "dir");
    await mkdir(join(root, "specs"), { recursive: true });
    await writeFile(join(root, "specs", `${SLUG}.md`), "# todo\n\nA CLI that counts its arguments.\n", "utf8");
    const productDir = join(root, ".factory", "runs");
    const env = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ANTHROPIC_API_KEY: "sk-ant-sentinel-0123456789" };
    const specCommands = { run: async (argv: readonly string[]) => ({ exitCode: 0, stdout: argv[0] === "finalize" ? JSON.stringify({ format_version: 1, ok: true, finalized_ids: [`${SLUG}:SUR-001`, `${SLUG}:CTR-001`, `${SLUG}:BEH-002`, `${SLUG}:CST-001`, `${SLUG}:POL-001`] }) : argv[0] === "lint" ? LINT_OK : argv[0] === "ready" ? JSON.stringify({ format_version: 1, ok: true, violations: [] }) : argv[1] === "list" ? recordsJson(DEFAULT_RECORDS.filter((record) => record.status === "approved")) : "", stderr: "" }) };
    const designCommands = { run: async (request: { readonly file: string; readonly args: readonly string[] }) => ({ exitCode: 0, stdout: request.args[1] === "record" ? recordsJson(DEFAULT_RECORDS) : "", stderr: "" }) };
    const assemblyCommands = fakeCommandRunner((invocation) => {
      const [command, tool, subcommand] = invocation.argv;
      if (command === "npm" || (command === "npx" && tool === "tsc")) {
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      }
      if (command === "npx" && tool === "sdd") {
        return { exitCode: 0, stdout: subcommand === "token" ? TOKEN : subcommand === "ready" ? sddReadyReport([]) : LINT_OK, stderr: "", durationMs: 1, timedOut: false };
      }
      return undefined;
    });
    let runDirProduct = "";
    const running = await startRun({
      repoRoot: root,
      specPath: join(root, "specs", `${SLUG}.md`),
      slug: SLUG,
      operator: "cyberash",
      push: false,
      outDir: null,
      config: { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, minCoversPerTask: 1 }, timeouts: { ...DEFAULT_CONFIG.timeouts, verifierMs: 120_000, cliRoleMs: 60_000, apiRoleMs: 60_000 } },
      stageSlices: [createTraceSlice({ env }), createSpecStageSlice({ commands: specCommands }), createDesignStageSlice({ commands: designCommands }), createBuildStageSlice({ commands: { run: async (command, args, options) => (command === "npm" ? { exitCode: 0, stdout: "", stderr: "" } : new ExecCommandRunner().run(command, args, options)) } }), createAssemblySlice({ commandRunner: assemblyCommands })],
      commandRunner: {
        async run(command, args, options) {
          runDirProduct = runDirProduct === "" ? options.cwd : runDirProduct;
          return factoryCommands(runDirProduct).run(command, args, options);
        },
      },
      versions: { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" },
      now: () => new Date(),
      log: () => undefined,
      env,
      roleRunners: { apiRoles: apiRoles(), cliRoles: laneRoles() },
    });
    const outcome = await running.terminal;
    await running.shutdown();

    const state: { status: string; failure: { reason: string; detail: string } | null; tasks: Record<string, { status: string }> } = JSON.parse(await readFile(join(running.paths.runDir, "state.json"), "utf8"));
    const hidden = join(root, "hidden", SLUG);
    const published = (await stat(hidden).catch(() => null)) === null ? [] : await listFiles(hidden);
    const interventions = await readFile(join(running.paths.traceDir, "interventions.md"), "utf8");
    expect([outcome.manifest.status, state.failure, Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, task.status])), published.includes("src/cli/index.ts") && published.includes("trace/trace.md"), interventions.includes("mid-run interventions: 0")]).toEqual([
      "published",
      null,
      { "T-001": "approved", "T-002": "approved" },
      true,
      true,
    ]);
    expect(productDir.length > 0).toBe(true);
  }, 240_000);
});
