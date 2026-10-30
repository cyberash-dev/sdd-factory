export interface FormatOnlyViolation {
  readonly id: string;
  readonly kind: "missing" | "changed";
}

/* Maps hold record id -> canonical JSON of the parsed record; records absent before are free to appear. */
export function formatOnlyViolations(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): readonly FormatOnlyViolation[] {
  const violations: FormatOnlyViolation[] = [];
  for (const [id, data] of before) {
    const next = after.get(id);
    if (next === undefined) {
      violations.push({ id, kind: "missing" });
    } else if (next !== data) {
      violations.push({ id, kind: "changed" });
    }
  }
  return violations;
}
