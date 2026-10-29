import type { EffectHandler } from "../../shared/slice.js";
import { isReworkTarget, type ReworkEntry, type TriageEntry } from "../domain/ledger.js";
import { updateLedger, writeFailedReport } from "./ledger-store.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTriageEntry(value: unknown): value is TriageEntry {
  return isRecord(value) && typeof value["round"] === "number" && (value["task_id"] === null || typeof value["task_id"] === "string") && isReworkTarget(value["target"]) && typeof value["reason"] === "string";
}

function isReworkEntry(value: unknown): value is ReworkEntry {
  return (
    isRecord(value) &&
    typeof value["round"] === "number" &&
    typeof value["task_id"] === "string" &&
    isReworkTarget(value["target"]) &&
    (value["source"] === "attribution" || value["source"] === "triage" || value["source"] === "sdd_ready")
  );
}

function entries<T>(value: unknown, guard: (item: unknown) => item is T): readonly T[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(guard)) {
    throw new Error("assembly.record: malformed entries");
  }
  return value;
}

export function recordEffect(): EffectHandler {
  return async (effect, _context, slice) => {
    const identity = { runDir: slice.paths.runDir, runId: slice.runId, slug: slice.slug };
    const triage = entries(effect["triage"], isTriageEntry);
    const reworks = entries(effect["reworks"], isReworkEntry);
    await updateLedger(identity, (ledger) => ({ ...ledger, triage: [...ledger.triage, ...triage], reworks: [...ledger.reworks, ...reworks] }));
    const failed = effect["failed"];
    if (typeof failed === "string") {
      await writeFailedReport(slice.paths, identity, failed);
    }
  };
}
