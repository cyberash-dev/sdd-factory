import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createExecFileProcessRunner } from "../../src/design-stage/adapters/outbound/exec-file-process-runner.js";
import { runArchitectEffect } from "../../src/design-stage/application/architect-effect.js";
import { runPlanEffect } from "../../src/design-stage/application/plan-effect.js";
import { runVerificationEffect } from "../../src/design-stage/application/verification-effect.js";
import { createGitWorkingTree, type SimpleFixDeps } from "../../src/shared/fixer/index.js";
import type { CliRoleOutcome, CliRoleRequest } from "../../src/shared/llm/cli-role-runner.js";
import type { SliceContext } from "../../src/shared/slice.js";
import { ARCHITECT_HANDOFF_LINES, handoffPathIn, handoffText, harness, PLANNER_HANDOFF_LINES, stateIn, tasksJsonText, techMdText, VALID_TASKS, VERIFICATION_HANDOFF_LINES, verificationMdText, writeVia, type Harness, type RoleScript } from "./harness.js";

const execFileAsync = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };

type FixerScript = (productDir: string) => Promise<void>;

interface FixerSetup {
  readonly slice: SliceContext;
  readonly fix: SimpleFixDeps;
  readonly fixerCalls: CliRoleRequest[];
}

function cliOutcome(): CliRoleOutcome {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    result: { isError: false, costUsd: 0.02, inputTokens: 500, outputTokens: 40, durationMs: 1500, resultText: "closed the quote", dominantModel: "claude-opus-5-5" },
    toolUses: [],
    stderrTail: "",
    durationMs: 1600,
  };
}

async function withFixer(h: Harness, script: FixerScript): Promise<FixerSetup> {
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: h.productDir, env: GIT_ENV });
  await execFileAsync("git", ["add", "-A"], { cwd: h.productDir, env: GIT_ENV });
  await execFileAsync("git", ["commit", "-q", "-m", "bootstrap"], { cwd: h.productDir, env: GIT_ENV });
  const fixerCalls: CliRoleRequest[] = [];
  const slice: SliceContext = {
    ...h.slice,
    cliRoles: {
      async run(request) {
        fixerCalls.push(request);
        await script(request.cwd);
        return cliOutcome();
      },
    },
  };
  return { slice, fix: { tree: createGitWorkingTree(createExecFileProcessRunner()), delay: async () => undefined }, fixerCalls };
}

async function replaceIn(productDir: string, path: string, from: string, to: string): Promise<void> {
  const text = await readFile(join(productDir, path), "utf8");
  await writeFile(join(productDir, path), text.replace(from, to), "utf8");
}

const leaveAsIs: FixerScript = async () => undefined;
const UNTERMINATED = 'notes: "unterminated';
const BROKEN_VERIFICATION = verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]).replace('obligation: "observable at the boundary"', `obligation: "observable at the boundary"\n${UNTERMINATED}`);
const VALID_VERIFICATION = verificationMdText(["todo-cli:CTR-001", "todo-cli:BEH-002"]);

function designerWriting(verificationMd: string): RoleScript {
  return async (request) => {
    await writeVia(request, "design/verification.md", verificationMd);
    await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
  };
}

function architectWriting(techMd: string): RoleScript {
  return async (request) => {
    await writeVia(request, "design/tech.md", techMd);
    await writeVia(request, handoffPathIn(request), handoffText("architect", 1, ARCHITECT_HANDOFF_LINES));
  };
}

function plannerWriting(tasksJson: string): RoleScript {
  return async (request) => {
    await writeVia(request, "design/tasks.json", tasksJson);
    await writeVia(request, "design/plan.md", "# Plan: todo-cli\n");
    await writeVia(request, handoffPathIn(request), handoffText("planner", 1, PLANNER_HANDOFF_LINES));
  };
}

async function seedDesign(productDir: string): Promise<void> {
  await mkdir(join(productDir, "design"), { recursive: true });
  await writeFile(join(productDir, "design", "tech.md"), techMdText(), "utf8");
  await writeFile(join(productDir, "design", "verification.md"), VALID_VERIFICATION, "utf8");
}

const eventTypes = (h: Harness): readonly string[] => h.published.map((event) => event.type);

describe("simple-fixer in front of a design file rework", () => {
  // @covers design-stage:DLT-005
  it("publishes design.verification.ready after one fix.attempted when the fixer closes an unterminated quote, invoking the designer once", async () => {
    const h = await harness({ scripts: { "verification-designer": [designerWriting(BROKEN_VERIFICATION)] }, caps: { simpleFixes: 2 } });
    const setup = await withFixer(h, (dir) => replaceIn(dir, "design/verification.md", UNTERMINATED, 'notes: "terminated"'));

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), setup.slice, h.commandRunner, setup.fix);

    expect([eventTypes(h), h.roleCalls.length]).toEqual([["fix.attempted", "design.verification.ready"], 1]);
  });

  // @covers design-stage:DLT-005
  it("reports the fixed run as trigger design_file_invalid owned by the verification-designer on unit design", async () => {
    const h = await harness({ scripts: { "verification-designer": [designerWriting(BROKEN_VERIFICATION)] }, caps: { simpleFixes: 2 } });
    const setup = await withFixer(h, (dir) => replaceIn(dir, "design/verification.md", UNTERMINATED, 'notes: "terminated"'));

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), setup.slice, h.commandRunner, setup.fix);

    const attempted = h.published[0]?.payload;
    expect([attempted?.["trigger"], attempted?.["owner"], attempted?.["unit"], attempted?.["taskId"], attempted?.["outcome"], attempted?.["filesChanged"]]).toEqual(["design_file_invalid", "verification-designer", "design", null, "fixed", ["design/verification.md"]]);
  });

  // @covers design-stage:DLT-005
  it("re-runs the designer with the parser message only after two fixer runs fail to repair the file", async () => {
    const h = await harness({ scripts: { "verification-designer": [designerWriting(BROKEN_VERIFICATION), designerWriting(VALID_VERIFICATION)] }, caps: { simpleFixes: 2 } });
    const setup = await withFixer(h, leaveAsIs);

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), setup.slice, h.commandRunner, setup.fix);

    expect([eventTypes(h), h.roleCalls.length, h.roleCalls[1]?.message.includes("- rework_finding: block todo-cli:CTR-001: yaml invalid:")]).toEqual([["fix.attempted", "fix.attempted", "design.verification.ready"], 2, true]);
  });

  // @covers design-stage:DLT-005
  it("blocks with verification_md_invalid without a third fixer run when the reworked file does not parse either", async () => {
    const h = await harness({ scripts: { "verification-designer": [designerWriting(BROKEN_VERIFICATION), designerWriting(BROKEN_VERIFICATION)] }, caps: { simpleFixes: 2 } });
    const setup = await withFixer(h, leaveAsIs);

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), setup.slice, h.commandRunner, setup.fix);

    expect([eventTypes(h), h.published[2]?.payload["reason"], setup.fixerCalls.length]).toEqual([["fix.attempted", "fix.attempted", "design.blocked"], "verification_md_invalid", 2]);
  });

  // @covers design-stage:DLT-005
  it("blocks at once without a fixer run when the designer never wrote the file", async () => {
    const onlyHandoff: RoleScript = async (request) => {
      await writeVia(request, handoffPathIn(request), handoffText("verification-designer", 1, VERIFICATION_HANDOFF_LINES));
    };
    const h = await harness({ scripts: { "verification-designer": [onlyHandoff] }, caps: { simpleFixes: 2 } });
    const setup = await withFixer(h, leaveAsIs);

    await runVerificationEffect({ kind: "design.verification", attempt: 1 }, h.context(stateIn("designing")), setup.slice, h.commandRunner, setup.fix);

    expect([eventTypes(h), setup.fixerCalls.length]).toEqual([["design.blocked"], 0]);
  });

  // @covers design-stage:DLT-005
  it("publishes design.tech.ready after the fixer restores a missing TD-TOOLING block", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText({ withTooling: false }))] }, caps: { simpleFixes: 2 } });
    const setup = await withFixer(h, async (dir) => writeFile(join(dir, "design", "tech.md"), techMdText(), "utf8"));

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), setup.slice, setup.fix);

    expect([eventTypes(h), h.roleCalls.length]).toEqual([["fix.attempted", "design.tech.ready"], 1]);
  });

  // @covers design-stage:DLT-005
  it("sends an unpinned dependency to the architect without a fixer run", async () => {
    const h = await harness({ scripts: { architect: [architectWriting(techMdText({ devDependencies: ["typescript"] }))] }, caps: { simpleFixes: 2 } });
    const setup = await withFixer(h, leaveAsIs);

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), setup.slice, setup.fix);

    expect([eventTypes(h), h.published[0]?.payload["target"], setup.fixerCalls.length]).toEqual([["design.rework"], "architect", 0]);
  });

  // @covers design-stage:DLT-005
  it("runs the fixer twice before design.rework{target: planner} when tasks.json has a trailing comma", async () => {
    const trailingComma = tasksJsonText(VALID_TASKS).replace(/\n}$/, ",\n}");
    const h = await harness({ scripts: { planner: [plannerWriting(trailingComma)] }, caps: { simpleFixes: 2 } });
    await seedDesign(h.productDir);
    const setup = await withFixer(h, leaveAsIs);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), setup.slice, h.commandRunner, setup.fix);

    expect([eventTypes(h), h.published[2]?.payload["target"], String(h.published[2]?.payload["reason"]).startsWith("schema: invalid JSON:")]).toEqual([["fix.attempted", "fix.attempted", "design.rework"], "planner", true]);
  });

  // @covers design-stage:DLT-005
  it("publishes design.tasks.ready when the fixer drops the trailing comma of tasks.json", async () => {
    const valid = tasksJsonText(VALID_TASKS);
    const h = await harness({ scripts: { planner: [plannerWriting(valid.replace(/\n}$/, ",\n}"))] }, caps: { simpleFixes: 2 } });
    await seedDesign(h.productDir);
    const setup = await withFixer(h, async (dir) => writeFile(join(dir, "design", "tasks.json"), valid, "utf8"));

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), setup.slice, h.commandRunner, setup.fix);

    expect(eventTypes(h)).toEqual(["fix.attempted", "design.tasks.ready"]);
  });

  // @covers design-stage:DLT-005
  it("sends a schema violation in valid JSON to the planner without a fixer run", async () => {
    const unknownField = tasksJsonText(VALID_TASKS).replace('"schemaVersion": 1', '"schemaVersion": 1,\n  "extra": true');
    const h = await harness({ scripts: { planner: [plannerWriting(unknownField)] }, caps: { simpleFixes: 2 } });
    await seedDesign(h.productDir);
    const setup = await withFixer(h, leaveAsIs);

    await runPlanEffect({ kind: "design.plan", attempt: 1, reworkFinding: "" }, h.context(stateIn("planning")), setup.slice, h.commandRunner, setup.fix);

    expect([eventTypes(h), setup.fixerCalls.length]).toEqual([["design.rework"], 0]);
  });
});
