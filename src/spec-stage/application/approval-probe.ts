import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { parseFinalizeEnvelope, parseReadyEnvelope, type ReadyViolation } from "../../shared/sdd/envelope.js";
import type { SliceContext } from "../../shared/slice.js";
import type { CommandRunner } from "../ports/command-runner.js";
import { outputTail, type StageDeps } from "./stage-deps.js";

export interface ProbeFinding {
  readonly kind: string;
  readonly recordId: string | null;
  readonly message: string;
}

/* spec-stage:DLT-010: these depend on tests and git state that do not exist before the build. */
const TEST_DEPENDENT_KINDS: ReadonlySet<string> = new Set(["uncovered", "orphan_covers", "unapproved", "aggregated_check", "debt_budget_increased"]);

async function scratchDirectory(runDir: string): Promise<string> {
  const parent = join(runDir, "tmp");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "approval-probe-"));
}

/* node_modules is linked, not copied: the product's own sdd CLI lives there. */
async function copyProduct(productDir: string, scratchDir: string): Promise<void> {
  const nodeModules = join(productDir, "node_modules");
  await cp(productDir, scratchDir, { recursive: true, verbatimSymlinks: true, filter: (source) => source !== nodeModules });
  await symlink(nodeModules, join(scratchDir, "node_modules"), "dir");
}

/* Surface violations carry the Surface in `id`; the record the analyst must edit is the member their remediation names. */
const NAMED_RECORD = /\b(?:record|member) ([a-z0-9][a-z0-9-]*:[A-Z]+-\d+)\b/;

function violationFinding(violation: ReadyViolation): ProbeFinding {
  const namedRecord = NAMED_RECORD.exec(violation.remediation)?.[1];
  return { kind: violation.kind, recordId: namedRecord ?? violation.id, message: violation.remediation };
}

async function scratchFindings(commands: CommandRunner, scratchDir: string, approvals: readonly (readonly string[])[]): Promise<readonly ProbeFinding[]> {
  for (const argv of approvals) {
    const approve = await commands.run(argv, scratchDir);
    if (approve.exitCode !== 0 && !approve.stdout.includes("no-id-match")) {
      return [{ kind: "approve_failed", recordId: null, message: outputTail(approve) }];
    }
  }
  const finalize = await commands.run(["finalize", "--format=json"], scratchDir);
  if (finalize.exitCode !== 0 || !parseFinalizeEnvelope(finalize.stdout).ok) {
    return [{ kind: "finalize_failed", recordId: null, message: outputTail(finalize) }];
  }
  const ready = await commands.run(["ready", "--format=json"], scratchDir);
  return parseReadyEnvelope(ready.stdout)
    .violations.filter((violation) => !TEST_DEPENDENT_KINDS.has(violation.kind))
    .map(violationFinding);
}

/* spec-stage:DLT-010: the approval and `sdd ready` run on a scratch copy, so the product directory stays untouched. */
export async function probeApproval(slice: SliceContext, deps: StageDeps, approvals: readonly (readonly string[])[]): Promise<readonly ProbeFinding[]> {
  const scratchDir = await scratchDirectory(slice.paths.runDir);
  try {
    await copyProduct(slice.paths.productDir, scratchDir);
    return await scratchFindings(deps.commands, scratchDir, approvals);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}
