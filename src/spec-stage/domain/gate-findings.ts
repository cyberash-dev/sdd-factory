import type { GaFindingKind } from "./ga-review.js";

export type GateFindingKind = Extract<GaFindingKind, "gap" | "conflict">;

export interface GateFailure {
  readonly kind: GateFindingKind;
  readonly targetIds: readonly string[];
  readonly text: string;
}

/* A JSON string literal is a valid YAML double-quoted scalar, so quotes, backslashes and newlines stay inside one line of the fence. */
function quoted(text: string): string {
  return JSON.stringify(text);
}

function renderFinding(failure: GateFailure, index: number): string {
  return [
    `- id: GATE-${String(index + 1).padStart(3, "0")}`,
    `  kind: ${failure.kind}`,
    `  target_ids: [${failure.targetIds.map(quoted).join(", ")}]`,
    "  source: none",
    "  resolution: decide",
    `  required_change: ${quoted(failure.text)}`,
    "  assumption: null",
  ].join("\n");
}

/* spec-stage:DLT-011: spec/review/gate.md, the ga.md format of spec-stage:CTR-003 with one finding per approval gate failure. */
export function renderGateFindings(slug: string, round: number, failures: readonly GateFailure[]): string {
  return `# Spec review: ${slug}, round ${round}

decision: rework

## Findings
\`\`\`yaml
${failures.map(renderFinding).join("\n")}
\`\`\`

## Assumptions
none

## Open-Q decisions
| Open-Q | option | finding | rationale |

## Coverage
none
`;
}
