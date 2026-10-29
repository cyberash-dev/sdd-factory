import { rename } from "node:fs/promises";
import { join } from "node:path";
import { describeHandoffError, parseHandoff, type ParsedHandoff } from "../../bus/domain/handoff.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import { listDirTool, readFileTool, writeFileTool } from "../../shared/llm/tools.js";
import type { SliceContext } from "../../shared/slice.js";
import { createFirewall, productRelative } from "../domain/firewall.js";
import type { RoleUsage } from "../domain/payloads.js";
import { HANDOFF_RERUN_SUFFIX } from "./messages.js";

export type StageRole = "architect" | "verification-designer" | "planner";

export interface StageRoleRequest {
  readonly role: StageRole;
  readonly message: string;
  readonly forbiddenReads: readonly string[];
}

export type StageRoleOutcome =
  | { readonly kind: "complete"; readonly handoff: ParsedHandoff; readonly usage: RoleUsage; readonly reruns: number }
  | { readonly kind: "blocked"; readonly reason: string; readonly detail: string; readonly usage: RoleUsage; readonly reruns: number };

const MAX_OUTPUT_TOKENS = 32768;

const COMMON_FORBIDDEN_READS: readonly string[] = ["src", "tests", "reviews", "node_modules"];

export function handoffPathOf(slice: SliceContext, role: StageRole): string {
  const path = join(slice.paths.handoffsDir, role, "handoff.md");
  if (productRelative(slice.paths.productDir, path).startsWith("..")) {
    throw new Error(`handoff path ${path} is outside the product directory ${slice.paths.productDir}`);
  }
  return path;
}

export function forbiddenReadsFor(slice: SliceContext, role: StageRole): readonly string[] {
  const handoffs = productRelative(slice.paths.productDir, slice.paths.handoffsDir);
  const specSource = productRelative(slice.paths.productDir, slice.paths.specSourcePath);
  const byRole: Readonly<Record<StageRole, readonly string[]>> = {
    architect: ["design/verification.md", "design/tasks.json", "design/plan.md"],
    "verification-designer": ["design/tech.md", "design/tasks.json", "design/plan.md", specSource],
    planner: [specSource],
  };
  return [...COMMON_FORBIDDEN_READS, handoffs, ...byRole[role]].filter((prefix) => !prefix.startsWith(".."));
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
  const firewall = createFirewall(slice.paths.productDir, request.forbiddenReads);
  const productDir = slice.paths.productDir;
  const tools = [readFileTool(productDir, firewall.trace), writeFileTool(productDir, firewall.trace), listDirTool(productDir, firewall.trace)];
  const model = slice.config.models.default;
  let usage = zeroUsage(model);
  let message = request.message;
  let reruns = 0;
  for (;;) {
    const run = await slice.apiRoles.run({ role: request.role, instruction, message, model, tools, timeoutMs: slice.config.timeouts.apiRoleMs, maxOutputTokens: MAX_OUTPUT_TOKENS });
    usage = addUsage(usage, run);
    const violations = firewall.violations();
    if (violations.length > 0) {
      return { kind: "blocked", reason: "context_firewall_violation", detail: `${request.role} read ${violations.join(", ")}`, usage, reruns };
    }
    const parsed = parseHandoff(request.role, await readTextOrNull(handoffPath));
    if (parsed.ok) {
      if (parsed.handoff.frontmatter["status"] === "blocked") {
        return { kind: "blocked", reason: `${request.role}_blocked`, detail: blockedReason(parsed.handoff), usage, reruns };
      }
      return { kind: "complete", handoff: parsed.handoff, usage, reruns };
    }
    const error = describeHandoffError(parsed.error);
    await keepRejected(handoffPath, reruns + 1);
    slice.log(`design-stage: ${request.role} handoff unparseable (${error}), reruns so far ${reruns}`);
    if (reruns >= slice.config.caps.handoffRerun) {
      return { kind: "blocked", reason: `${request.role}_unparseable_handoff`, detail: error, usage, reruns };
    }
    reruns += 1;
    message = request.message + slice.prompts.render(HANDOFF_RERUN_SUFFIX, { handoff_path: productRelative(productDir, handoffPath), handoff_error: error });
  }
}
