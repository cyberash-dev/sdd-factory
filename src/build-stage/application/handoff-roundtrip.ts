import { rename } from "node:fs/promises";
import type { HandoffRole } from "../../bus/domain/handoff.js";
import { readTextOrNull } from "../../shared/fs/text.js";

export type ParseOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface RoleInvocation<TRun, TParsed> {
  readonly role: HandoffRole;
  readonly handoffPath: string;
  readonly maxReruns: number;
  invoke(message: string): Promise<TRun>;
  parse(): Promise<ParseOutcome<TParsed>>;
}

export type RoundtripResult<TRun, TParsed> =
  | { readonly ok: true; readonly run: TRun; readonly parsed: TParsed; readonly reruns: number }
  | { readonly ok: false; readonly run: TRun | null; readonly error: string; readonly reruns: number };

export function rejectedSuffix(rerun: number): string {
  return `.rejected-${rerun}`;
}

async function keepMalformed(handoffPath: string, rerun: number): Promise<void> {
  if ((await readTextOrNull(handoffPath)) !== null) {
    await rename(handoffPath, `${handoffPath}${rejectedSuffix(rerun)}`);
  }
}

export function handoffRejectionNote(handoffPath: string, error: string): string {
  return `\n\n## Previous handoff rejected\n\nYour previous handoff at \`${handoffPath}\` could not be parsed: \`${error}\`. Redo the work if needed and write the handoff again with exactly the required frontmatter keys and enum values.`;
}

/* build-stage:BEH-015: one automatic re-run with the parse error appended, then the caller fails the task. */
export async function runWithHandoffRetry<TRun, TParsed>(invocation: RoleInvocation<TRun, TParsed>, message: string): Promise<RoundtripResult<TRun, TParsed>> {
  let lastRun: TRun | null = null;
  let lastError = "missing_file";
  let currentMessage = message;
  for (let rerun = 0; rerun <= invocation.maxReruns; rerun += 1) {
    lastRun = await invocation.invoke(currentMessage);
    const outcome = await invocation.parse();
    if (outcome.ok) {
      return { ok: true, run: lastRun, parsed: outcome.value, reruns: rerun };
    }
    lastError = outcome.error;
    await keepMalformed(invocation.handoffPath, rerun + 1);
    currentMessage = `${message}${handoffRejectionNote(invocation.handoffPath, outcome.error)}`;
  }
  return { ok: false, run: lastRun, error: lastError, reruns: invocation.maxReruns };
}
