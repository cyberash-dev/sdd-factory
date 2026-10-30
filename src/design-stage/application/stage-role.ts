import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describeHandoffError, parseHandoff, type ParsedHandoff } from "../../bus/domain/handoff.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import { isRoleTimeout, roleTimeoutNote } from "../../shared/llm/api-role-runner.js";
import type { SliceContext } from "../../shared/slice.js";
import { canonicalPath, fileTools } from "../adapters/outbound/role-tools.js";
import { createFirewall } from "../domain/firewall.js";
import type { RoleUsage } from "../domain/payloads.js";
import { FIREWALL_RERUN_SUFFIX, HANDOFF_RERUN_SUFFIX } from "./messages.js";

export type StageRole = "architect" | "verification-designer" | "planner";

/* design-stage:DLT-007: a repair runs while the run is building, after the planner has cut the design. */
export type StageRoleMode = "first_pass" | "repair";

export interface StageRoleRequest {
  readonly role: StageRole;
  readonly message: string;
  readonly mode?: StageRoleMode;
}

export type StageRoleOutcome =
  | { readonly kind: "complete"; readonly handoff: ParsedHandoff; readonly usage: RoleUsage; readonly reruns: number }
  | { readonly kind: "blocked"; readonly reason: string; readonly detail: string; readonly usage: RoleUsage; readonly reruns: number };

interface RoleScope {
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly lists: readonly string[];
  readonly deniedReads: readonly string[];
}

const MAX_OUTPUT_TOKENS = 32768;

export function handoffPathOf(slice: SliceContext, role: StageRole): string {
  return join(slice.paths.handoffsDir, role, "handoff.md");
}

/* Absolute prefixes a role must never read (design-stage:BEH-001); also the deny-list of its tools. */
export function forbiddenReadsFor(slice: SliceContext, role: StageRole, mode: StageRoleMode = "first_pass"): readonly string[] {
  const { productDir, specSourcePath, handoffsDir } = slice.paths;
  const design = (file: string) => join(productDir, "design", file);
  const common = [join(productDir, "src"), join(productDir, "tests"), join(productDir, "reviews"), join(productDir, "node_modules"), handoffsDir];
  const byRole: Readonly<Record<StageRole, readonly string[]>> = {
    architect: mode === "repair" ? [design("verification.md")] : [design("verification.md"), design("tasks.json"), design("plan.md")],
    "verification-designer": [design("tech.md"), design("tasks.json"), design("plan.md"), specSourcePath],
    planner: [specSourcePath],
  };
  return [...common, ...byRole[role]];
}

function scopeFor(slice: SliceContext, role: StageRole, mode: StageRoleMode): RoleScope {
  const { productDir, specSourcePath, handoffsDir } = slice.paths;
  const design = (file: string) => join(productDir, "design", file);
  const ownFiles: Readonly<Record<StageRole, readonly string[]>> = {
    architect: [design("tech.md")],
    "verification-designer": [design("verification.md")],
    planner: [design("tasks.json"), design("plan.md")],
  };
  /* design-stage:DLT-003: the architect owns TD-TOOLING, so it may read the files the bootstrap scaffolded. */
  const toolingFiles = role === "architect" ? ["package.json", "tsconfig.json", "vitest.config.ts"].map((file) => join(productDir, file)) : [];
  return {
    reads: [specSourcePath, join(productDir, "spec"), join(productDir, "design"), ...toolingFiles],
    writes: [...ownFiles[role], join(handoffsDir, role)],
    lists: [productDir],
    deniedReads: forbiddenReadsFor(slice, role, mode),
  };
}

export function zeroUsage(model: string): RoleUsage {
  return { model, costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
}

export function addUsage(total: RoleUsage, run: RoleUsage): RoleUsage {
  return {
    model: run.model,
    costUsd: total.costUsd === null || run.costUsd === null ? null : total.costUsd + run.costUsd,
    inputTokens: total.inputTokens + run.inputTokens,
    outputTokens: total.outputTokens + run.outputTokens,
    durationMs: total.durationMs + run.durationMs,
  };
}

async function keepRejected(handoffPath: string, ordinal: number): Promise<void> {
  if ((await readTextOrNull(handoffPath)) === null) {
    return;
  }
  await rename(handoffPath, `${handoffPath}.rejected-${ordinal}`);
}

function blockedReason(handoff: ParsedHandoff): string {
  const reason = handoff.frontmatter["blocked_reason"];
  return typeof reason === "string" && reason.length > 0 ? reason : handoff.body.trim();
}

/* Runs one stage role to a parseable handoff, re-running once on an unparseable one (bus:BEH-003). */
export async function runStageRole(slice: SliceContext, request: StageRoleRequest): Promise<StageRoleOutcome> {
  const handoffPath = handoffPathOf(slice, request.role);
  const instruction = await slice.prompts.load(request.role);
  const scope = scopeFor(slice, request.role, request.mode ?? "first_pass");
  const model = slice.config.models.default;
  let usage = zeroUsage(model);
  let message = request.message;
  let reruns = 0;
  let firewallReruns = 0;
  for (;;) {
    const firewall = createFirewall(canonicalPath(slice.paths.productDir), scope.deniedReads.map(canonicalPath));
    const tools = fileTools({ repoRoot: slice.paths.repoRoot, productDir: slice.paths.productDir, ...scope, trace: firewall.trace });
    let timedOut = false;
    try {
      const run = await slice.apiRoles.run({ role: request.role, instruction, message, model, tools, timeoutMs: slice.config.timeouts.apiRoleMs, maxOutputTokens: MAX_OUTPUT_TOKENS, toolTracePath: join(dirname(handoffPath), `tools-run${reruns + 1}.jsonl`) });
      usage = addUsage(usage, run);
    } catch (error) {
      if (!isRoleTimeout(error)) {
        throw error;
      }
      /* factory:BEH-011: a handoff written before the budget ran out still counts; otherwise the timeout is a re-run. */
      timedOut = true;
    }
    const violations = firewall.violations();
    if (violations.length > 0) {
      const files = violations.join(", ");
      /* design-stage:DLT-007: the first forbidden read re-runs the role from its first message, without the file it read. */
      if (firewallReruns > 0 || reruns >= slice.config.caps.handoffRerun) {
        return { kind: "blocked", reason: "context_firewall_violation", detail: `${request.role} read ${files}`, usage, reruns };
      }
      await keepRejected(handoffPath, reruns + 1);
      slice.log(`design-stage: ${request.role} read ${files}, re-running once`);
      firewallReruns += 1;
      reruns += 1;
      message = request.message + slice.prompts.render(FIREWALL_RERUN_SUFFIX, { files });
      continue;
    }
    const parsed = parseHandoff(request.role, await readTextOrNull(handoffPath));
    if (parsed.ok) {
      if (parsed.handoff.frontmatter["status"] === "blocked") {
        return { kind: "blocked", reason: `${request.role}_blocked`, detail: blockedReason(parsed.handoff), usage, reruns };
      }
      return { kind: "complete", handoff: parsed.handoff, usage, reruns };
    }
    const error = timedOut ? `${request.role}_timeout: exceeded ${slice.config.timeouts.apiRoleMs} ms without a handoff` : describeHandoffError(parsed.error);
    await keepRejected(handoffPath, reruns + 1);
    slice.log(`design-stage: ${request.role} ${timedOut ? "timed out" : `handoff unparseable (${error})`}, reruns so far ${reruns}`);
    if (reruns >= slice.config.caps.handoffRerun) {
      return { kind: "blocked", reason: timedOut ? `${request.role}_timeout` : `${request.role}_unparseable_handoff`, detail: error, usage, reruns };
    }
    reruns += 1;
    message = request.message + (timedOut ? roleTimeoutNote(slice.config.timeouts.apiRoleMs) : slice.prompts.render(HANDOFF_RERUN_SUFFIX, { handoff_path: handoffPath, handoff_error: error }));
  }
}
