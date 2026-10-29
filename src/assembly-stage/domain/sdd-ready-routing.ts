import type { ReadyEnvelope } from "../../shared/sdd/envelope.js";

export const ROUTED_BY_ID_KINDS: readonly string[] = ["uncovered"];
export const ROUTED_BY_FILE_KINDS: readonly string[] = ["orphan_covers", "unknown_partition_covers"];
export const SPEC_GATE_KINDS: readonly string[] = ["unapproved"];

export function failingCoversOf(envelope: ReadyEnvelope): readonly string[] {
  const ids = envelope.violations
    .filter((violation) => ROUTED_BY_ID_KINDS.includes(violation.kind) || ROUTED_BY_FILE_KINDS.includes(violation.kind))
    .map((violation) => violation.id)
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}
