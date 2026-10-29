export interface SddReadyViolation {
  readonly kind: string;
  readonly id: string | null;
  readonly file: string | null;
}

export interface SddReadySummary {
  readonly ok: boolean;
  readonly violations: readonly SddReadyViolation[];
}

export const ROUTED_BY_ID_KINDS: readonly string[] = ["uncovered"];
export const ROUTED_BY_FILE_KINDS: readonly string[] = ["orphan_covers", "unknown_partition_covers"];
export const SPEC_GATE_KINDS: readonly string[] = ["unapproved"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseSddReadyReport(text: string): SddReadySummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed["ok"] !== "boolean") {
    return null;
  }
  const violations = Array.isArray(parsed["violations"]) ? parsed["violations"] : [];
  return {
    ok: parsed["ok"],
    violations: violations
      .filter((violation): violation is Record<string, unknown> => isRecord(violation) && typeof violation["kind"] === "string")
      .map((violation) => ({ kind: String(violation["kind"]), id: stringOrNull(violation["id"]), file: stringOrNull(violation["file"]) })),
  };
}

export function failingCoversOf(summary: SddReadySummary): readonly string[] {
  const ids = summary.violations
    .filter((violation) => ROUTED_BY_ID_KINDS.includes(violation.kind) || ROUTED_BY_FILE_KINDS.includes(violation.kind))
    .map((violation) => violation.id)
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}
