import { rename } from "node:fs/promises";
import type { Tool } from "@mozaik-ai/core";
import { describeHandoffError, parseHandoff, type ParsedHandoff } from "../../bus/domain/handoff.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";

export type HandoffVerdict<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "retry"; readonly error: string }
  | { readonly kind: "abort"; readonly error: string };

export interface RoleInvocation<T> {
  readonly role: "spec-analyst" | "spec-critic";
  readonly instruction: string;
  readonly message: string;
  readonly model: string;
  readonly tools: readonly Tool[];
  readonly maxOutputTokens: number;
  readonly handoffPath: string;
  verify(handoff: ParsedHandoff): Promise<HandoffVerdict<T>>;
}

export type RoleOutcome<T> =
  | { readonly kind: "ok"; readonly value: T; readonly reruns: number }
  | { readonly kind: "aborted"; readonly error: string }
  | { readonly kind: "unparseable"; readonly error: string; readonly reruns: number };

export function promptBody(promptText: string): string {
  const lines = promptText.split(/\r?\n/);
  if (lines[0] !== "---") {
    return promptText;
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  return end === -1 ? promptText : lines.slice(end + 1).join("\n").trimStart();
}

function rejectionNote(invocation: RoleInvocation<unknown>, error: string): string {
  return `${invocation.message}\n\nYour previous handoff was rejected: ${error}. Write ${invocation.handoffPath} again with every required key and value.`;
}

export async function invokeRole<T>(slice: SliceContext, invocation: RoleInvocation<T>): Promise<RoleOutcome<T>> {
  let message = invocation.message;
  let lastError = "";
  const allowedRuns = slice.config.caps.handoffRerun + 1;
  for (let run = 1; run <= allowedRuns; run += 1) {
    await slice.apiRoles.run({
      role: invocation.role,
      instruction: invocation.instruction,
      message,
      model: invocation.model,
      tools: invocation.tools,
      timeoutMs: slice.config.timeouts.apiRoleMs,
      maxOutputTokens: invocation.maxOutputTokens,
    });
    const text = await readTextOrNull(invocation.handoffPath);
    const parsed = parseHandoff(invocation.role, text);
    const verdict: HandoffVerdict<T> = parsed.ok ? await invocation.verify(parsed.handoff) : { kind: "retry", error: describeHandoffError(parsed.error) };
    if (verdict.kind === "ok") {
      return { kind: "ok", value: verdict.value, reruns: run - 1 };
    }
    if (verdict.kind === "abort") {
      return { kind: "aborted", error: verdict.error };
    }
    lastError = verdict.error;
    slice.log(`${invocation.role} handoff rejected (run ${run}/${allowedRuns}): ${verdict.error}`);
    if (text !== null) {
      await rename(invocation.handoffPath, `${invocation.handoffPath}.rejected-${run}`);
    }
    message = rejectionNote(invocation, verdict.error);
  }
  return { kind: "unparseable", error: lastError, reruns: allowedRuns - 1 };
}
