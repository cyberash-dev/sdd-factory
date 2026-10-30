import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createExecFileProcessRunner } from "../../src/spec-stage/adapters/exec-file-process-runner.js";
import { createGitWorkingTree } from "../../src/shared/fixer/index.js";
import type { CliRoleOutcome, CliRoleRequest, CliRoleRunner } from "../../src/shared/llm/cli-role-runner.js";
import type { SliceContext } from "../../src/shared/slice.js";
import { runApprove } from "../../src/spec-stage/application/approve.js";
import { runDraft } from "../../src/spec-stage/application/draft.js";
import { createStageClock } from "../../src/spec-stage/application/stage-clock.js";
import type { StageDeps } from "../../src/spec-stage/application/stage-deps.js";
import type { CommandResult } from "../../src/spec-stage/ports/command-runner.js";
import { analystHandoff, CLI_SPEC, effectContext, runStateAt, scriptedCommands, scriptedRoles, sddReplies, sliceContext, stageWorkspace, writeText, type FakeCommands, type StageWorkspace } from "./harness.js";

const execFileAsync = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };

const BROKEN_TITLE = "title: `todo add` stores: items";
const QUOTED_TITLE = 'title: "`todo add` stores: items"';
const BROKEN_SPEC = CLI_SPEC.replace("title: todo add <text>", BROKEN_TITLE);

type FixerEdit = (specText: string) => string;

interface FixerSite {
  readonly ws: StageWorkspace;
  readonly slice: SliceContext;
  readonly fixerRequests: CliRoleRequest[];
}

async function gitProduct(ws: StageWorkspace): Promise<void> {
  await execFileAsync("git", ["init", "-q", "-b", "integration"], { cwd: ws.productDir, env: GIT_ENV });
  await execFileAsync("git", ["add", "-A"], { cwd: ws.productDir, env: GIT_ENV });
  await execFileAsync("git", ["commit", "-q", "-m", "spec skeleton"], { cwd: ws.productDir, env: GIT_ENV });
}

function fixerOutcome(): CliRoleOutcome {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    result: { isError: false, costUsd: 0.01, inputTokens: 300, outputTokens: 20, durationMs: 900, resultText: "quoted the scalar", dominantModel: "claude-opus-5-5" },
    toolUses: [],
    stderrTail: "",
    durationMs: 1000,
  };
}

function scriptedFixer(ws: StageWorkspace, edit: FixerEdit, requests: CliRoleRequest[]): CliRoleRunner {
  return {
    async run(request) {
      requests.push(request);
      await writeFile(ws.specPath, edit(await readFile(ws.specPath, "utf8")), "utf8");
      return fixerOutcome();
    },
  };
}

async function fixerSite(specText: string, edit: FixerEdit, analyst: (ws: StageWorkspace) => Promise<void>): Promise<FixerSite> {
  const ws = await stageWorkspace(specText);
  await gitProduct(ws);
  const fixerRequests: CliRoleRequest[] = [];
  const slice = { ...sliceContext(ws, scriptedRoles([() => analyst(ws)])), cliRoles: scriptedFixer(ws, edit, fixerRequests) };
  return { ws, slice, fixerRequests };
}

function stageDeps(commands: FakeCommands): StageDeps {
  return { commands, clock: createStageClock(), fixer: { tree: createGitWorkingTree(createExecFileProcessRunner()), delay: async () => undefined } };
}

const handoffPath = (ws: StageWorkspace): string => join(ws.handoffsDir, "spec-analyst", "handoff.md");
const quoteTitle: FixerEdit = (text) => text.replace(BROKEN_TITLE, QUOTED_TITLE);
const lintCapHandoff = (ws: StageWorkspace): Promise<void> => writeText(handoffPath(ws), analystHandoff(1, { status: "blocked", lint_exit: 1, blocked_reason: "lint_cap yaml_invalid" }));
const completeHandoff = (ws: StageWorkspace): Promise<void> => writeText(handoffPath(ws), analystHandoff(1));

describe("spec_yaml_invalid simple-fixer in the spec stage", () => {
  // @covers spec-stage:DLT-006
  it("publishes spec.drafted with lintExit 0 after one fix.attempted when the fixer quotes the colon after a complete handoff", async () => {
    const site = await fixerSite(BROKEN_SPEC, quoteTitle, completeHandoff);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, site.slice, stageDeps(scriptedCommands(sddReplies({}))));

    expect(published.map((event) => [event.type, event.payload["outcome"] ?? event.payload["lintExit"]])).toEqual([
      ["fix.attempted", "fixed"],
      ["spec.drafted", 0],
    ]);
  });

  // @covers spec-stage:DLT-006
  it("publishes spec.drafted with record counts read from the spec instead of spec.blocked when a lint_cap handoff leaves a yaml_invalid fence the fixer repairs", async () => {
    const site = await fixerSite(BROKEN_SPEC, quoteTitle, lintCapHandoff);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, site.slice, stageDeps(scriptedCommands(sddReplies({}))));

    expect(published.map((event) => [event.type, event.type === "spec.drafted" ? event.payload : event.payload["outcome"]])).toEqual([
      ["fix.attempted", "fixed"],
      ["spec.drafted", { attempt: 1, lintExit: 0, recordCounts: { behaviors: 0, contracts: 1, invariants: 0, scenarios: 0, constraints: 0, policies: 0, open_questions: 1, assumptions: 1 } }],
    ]);
  });

  // @covers spec-stage:DLT-006
  it("never runs the fixer and blocks with lint_failed when the lint fails on a missing required field only", async () => {
    const missingField: CommandResult = { exitCode: 1, stdout: '{"diagnostics":[{"rule":"sdd:required-field","id":"todo-cli:CTR-001"}]}', stderr: "" };
    const site = await fixerSite(CLI_SPEC, quoteTitle, completeHandoff);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, site.slice, stageDeps(scriptedCommands(sddReplies({ lint: missingField }))));

    expect([site.fixerRequests.length, published.map((event) => [event.type, String(event.payload["detail"]).split(":")[0]])]).toEqual([0, [["spec.blocked", "lint_failed"]]]);
  });

  // @covers spec-stage:DLT-006
  it("discards a fixer run that changes a field of a parseable record and restores the spec file", async () => {
    const renameSurface: FixerEdit = (text) => quoteTitle(text).replace("name: todo-cli", "name: todo");
    const site = await fixerSite(BROKEN_SPEC, renameSurface, completeHandoff);
    const { context, published } = effectContext(runStateAt("spec_drafting"));

    await runDraft({ kind: "spec.draft", attempt: 1, reworkFinding: null }, context, site.slice, stageDeps(scriptedCommands(sddReplies({}))));

    expect([published.map((event) => event.payload["outcome"] ?? event.type), await readFile(site.ws.specPath, "utf8")]).toEqual([["discarded", "discarded", "spec.blocked"], BROKEN_SPEC]);
  });

  // @covers spec-stage:DLT-006
  it("approves the spec after the fixer repairs a yaml_invalid fence found by the lint before approval", async () => {
    const finalized: CommandResult = { exitCode: 0, stdout: '{"format_version":1,"ok":true,"plan_id":"p","flipped":["todo-cli:CTR-001"],"files_changed":["spec/spec.md"],"archived_path":"x"}\n', stderr: "" };
    const site = await fixerSite(BROKEN_SPEC, quoteTitle, async () => undefined);
    const { context, published } = effectContext(runStateAt("spec_review"));

    await runApprove({ kind: "spec.approve" }, context, site.slice, stageDeps(scriptedCommands(sddReplies({ finalize: finalized }))));

    expect(published.map((event) => event.type)).toEqual(["fix.attempted", "spec.approved"]);
  });
});
