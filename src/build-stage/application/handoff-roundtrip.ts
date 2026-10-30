import { rename } from "node:fs/promises";
import type { HandoffRole } from "../../bus/domain/handoff.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import { isRoleTimeout } from "../../shared/llm/api-role-runner.js";

export type ParseOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface RoleInvocation<TRun, TParsed> {
  readonly role: HandoffRole;
  readonly handoffPath: string;
  readonly maxReruns: number;
  invoke(message: string): Promise<TRun>;
  parse(): Promise<ParseOutcome<TParsed>>;
  /* factory:BEH-011: when set, a role timeout is a re-run with this note instead of an error; `run` stands in for the lost attempt. */
  readonly timeout?: { readonly note: string; readonly run: TRun };
  /* build-stage:DLT-004: one more run after the re-runs, e.g. the reviewer on models.default. */
  readonly fallback?: (message: string) => Promise<TRun>;
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
  const lastRerun = invocation.maxReruns + (invocation.fallback === undefined ? 0 : 1);
  for (let rerun = 0; rerun <= lastRerun; rerun += 1) {
    const invoke = rerun > invocation.maxReruns && invocation.fallback !== undefined ? invocation.fallback : (text: string): Promise<TRun> => invocation.invoke(text);
    let timedOut = false;
    let run: TRun;
    try {
      run = await invoke(currentMessage);
    } catch (error) {
      if (invocation.timeout === undefined || !isRoleTimeout(error)) {
        throw error;
      }
      timedOut = true;
      run = invocation.timeout.run;
    }
    lastRun = run;
    const outcome = await invocation.parse();
    if (outcome.ok) {
      return { ok: true, run, parsed: outcome.value, reruns: rerun };
    }
    lastError = timedOut ? `${invocation.role}_timeout: ${outcome.error}` : outcome.error;
    await keepMalformed(invocation.handoffPath, rerun + 1);
    currentMessage = `${message}${timedOut && invocation.timeout !== undefined ? invocation.timeout.note : handoffRejectionNote(invocation.handoffPath, outcome.error)}`;
  }
  return { ok: false, run: lastRun, error: lastError, reruns: lastRerun };
}
