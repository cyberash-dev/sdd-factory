import { describe, expect, it } from "vitest";
import { renderGateFindings } from "./gate-findings.js";

describe("approval gate findings file", () => {
  // @covers spec-stage:DLT-011
  it("renders a lint failure naming todo:IB-001 as finding GATE-001 of a rework review in the ga.md format", () => {
    const failure = { kind: "gap", targetIds: ["todo:IB-001"], text: 'sdd:boundary-policy-ref at spec/spec.md:1843: Boundary ImplementationBinding "todo:IB-001" must declare policy_refs' } as const;

    const rendered = renderGateFindings("todo", 1, [failure]);

    expect(rendered).toBe(`# Spec review: todo, round 1

decision: rework

## Findings
\`\`\`yaml
- id: GATE-001
  kind: gap
  target_ids: ["todo:IB-001"]
  source: none
  resolution: decide
  required_change: "sdd:boundary-policy-ref at spec/spec.md:1843: Boundary ImplementationBinding \\"todo:IB-001\\" must declare policy_refs"
  assumption: null
\`\`\`

## Assumptions
none

## Open-Q decisions
| Open-Q | option | finding | rationale |

## Coverage
none
`);
  });

  // @covers spec-stage:DLT-011
  it("renders an integrity problem without a record id as a conflict with no target ids", () => {
    const failure = { kind: "conflict", targetIds: [], text: "spec_integrity: expected exactly one Surface, found 2" } as const;

    const rendered = renderGateFindings("todo", 2, [failure]);

    expect(rendered).toContain('- id: GATE-001\n  kind: conflict\n  target_ids: []\n  source: none\n  resolution: decide\n  required_change: "spec_integrity: expected exactly one Surface, found 2"\n');
  });

  // @covers spec-stage:DLT-011
  it("numbers one finding per failure from GATE-001 upward", () => {
    const failures = [
      { kind: "conflict", targetIds: ["todo:OQ-001"], text: "spec_integrity: todo:OQ-001 is blocking" },
      { kind: "conflict", targetIds: ["todo:CTR-001", "todo:SUR-001"], text: "spec_integrity: todo:CTR-001 is not a member of todo:SUR-001" },
    ] as const;

    const rendered = renderGateFindings("todo", 1, failures);

    expect(rendered.match(/^- id: GATE-[0-9]{3}$/gm)).toEqual(["- id: GATE-001", "- id: GATE-002"]);
  });

  // @covers spec-stage:DLT-011
  it("keeps a multi-line failure text on one double-quoted line inside the findings fence", () => {
    const failure = { kind: "gap", targetIds: [], text: "finalize_failed: refused\n```\nproposed-references" } as const;

    const rendered = renderGateFindings("todo", 1, [failure]);

    expect(rendered).toContain('  required_change: "finalize_failed: refused\\n```\\nproposed-references"\n');
  });
});
