import { join } from "node:path";
import { readTextOrNull, writeTextAtomic } from "../../shared/fs/text.js";
import type { RunPaths } from "../../shared/slice.js";
import { emptyLedger, isLedger, renderReport, type AssemblyLedger, type ReportOutcome } from "../domain/ledger.js";

export const LEDGER_FILE = "assembly/ledger.json";
export const REPORT_FILE = "assembly/report.md";

export interface LedgerIdentity {
  readonly runDir: string;
  readonly runId: string;
  readonly slug: string;
}

export async function loadLedger(identity: LedgerIdentity): Promise<AssemblyLedger> {
  const text = await readTextOrNull(join(identity.runDir, LEDGER_FILE));
  if (text === null) {
    return emptyLedger(identity.runId, identity.slug);
  }
  const stored: unknown = JSON.parse(text);
  /* A ledger written before assembly-stage:DLT-001 has no fixes list; a resumed run keeps it. */
  const parsed = typeof stored === "object" && stored !== null && !Array.isArray(stored) && !("fixes" in stored) ? { ...stored, fixes: [] } : stored;
  if (!isLedger(parsed)) {
    throw new Error(`${LEDGER_FILE} is not an assembly ledger`);
  }
  return parsed;
}

export async function updateLedger(identity: LedgerIdentity, patch: (ledger: AssemblyLedger) => AssemblyLedger): Promise<AssemblyLedger> {
  const next = patch(await loadLedger(identity));
  await writeTextAtomic(join(identity.runDir, LEDGER_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function writeRunDirReport(runDir: string, ledger: AssemblyLedger, outcome: ReportOutcome): Promise<string> {
  const path = join(runDir, REPORT_FILE);
  await writeTextAtomic(path, renderReport(ledger, outcome));
  return path;
}

export async function writeProductReport(paths: Pick<RunPaths, "productDir" | "runDir">, ledger: AssemblyLedger, outcome: ReportOutcome): Promise<string> {
  const path = join(paths.productDir, REPORT_FILE);
  await writeTextAtomic(path, renderReport(ledger, outcome));
  await writeRunDirReport(paths.runDir, ledger, outcome);
  return path;
}

export async function writeFailedReport(paths: Pick<RunPaths, "productDir" | "runDir">, identity: LedgerIdentity, detail: string): Promise<void> {
  await writeProductReport(paths, await loadLedger(identity), { verdict: "failed", detail });
}
