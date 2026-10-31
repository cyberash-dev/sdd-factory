export const ASSEMBLY_RED = "assembly_red";
export const TRIAGE = "triage";
export const WRITE_SET_CONFLICT = "write_set_conflict";

export function sddReadyReason(kind: string, reference: string): string {
  return `${kind} ${reference}`;
}

export function uncoveredWithoutOwnerReason(specIds: readonly string[]): string {
  return `uncovered without owner: ${specIds.join(", ")}`;
}
