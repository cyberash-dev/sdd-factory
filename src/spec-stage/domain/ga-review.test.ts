import { describe, expect, it } from "vitest";
import { derivedDecision, parseGaReview } from "./ga-review.js";

const ROUND_ONE = `# Spec review: todo-cli, round 1

decision: rework

## Findings
\`\`\`yaml
- id: GA-001
  kind: gap
  target_ids: [todo-cli:CTR-001]
  source: L14
  resolution: decide
  required_change: |
    CTR-001.error_taxonomy gains "exit 2 - E_EMPTY_TEXT".
  assumption: null
- id: GA-002
  kind: missing_negative
  target_ids: [todo-cli:OQ-001, todo-cli:ASM-001]
  source: none
  resolution: assume
  required_change: none
  assumption: todo-cli:ASM-001
\`\`\`

## Assumptions

## Open-Q decisions
| Open-Q | option | finding | rationale |
| todo-cli:OQ-001 | a | GA-002 | L14 |

## Coverage
none
`;

const ROUND_TWO = `# Spec review: todo-cli, round 2

decision: accept

## Findings
\`\`\`yaml
- id: GA-001
  kind: gap
  target_ids: [todo-cli:CTR-001]
  resolution: decide
  required_change: applied in CTR-001
  applied: yes
\`\`\`
`;

describe("ga.md review file", () => {
  // @covers spec-stage:CTR-003
  it("parses round 1 into the decision line and typed findings", () => {
    const result = parseGaReview(ROUND_ONE);

    expect(result).toEqual({
      ok: true,
      review: {
        slug: "todo-cli",
        round: 1,
        decision: "rework",
        findings: [
          { id: "GA-001", kind: "gap", targetIds: ["todo-cli:CTR-001"], severity: "major", resolution: "decide", requiredChange: 'CTR-001.error_taxonomy gains "exit 2 - E_EMPTY_TEXT".\n', assumption: null, applied: null },
          { id: "GA-002", kind: "missing_negative", targetIds: ["todo-cli:OQ-001", "todo-cli:ASM-001"], severity: "major", resolution: "assume", requiredChange: "none", assumption: "todo-cli:ASM-001", applied: null },
        ],
      },
    });
  });

  // @covers spec-stage:CTR-003
  it("parses the round 2 applied marker and derives accept when every decide finding is applied", () => {
    const result = parseGaReview(ROUND_TWO);

    expect(result.ok && [result.review.findings[0]?.applied, derivedDecision(result.review.findings, 2)]).toEqual([true, "accept"]);
  });

  // @covers spec-stage:CTR-003
  it("derives rework in round 2 while a decide finding stays open", () => {
    const result = parseGaReview(ROUND_TWO.replace("applied: yes", "applied: no"));

    expect(result.ok && derivedDecision(result.review.findings, 2)).toBe("rework");
  });

  // @covers spec-stage:CTR-003
  it("derives rework in round 1 as soon as one finding needs a decision", () => {
    const result = parseGaReview(ROUND_ONE);

    expect(result.ok && derivedDecision(result.review.findings, 1)).toBe("rework");
  });

  it("derives accept in round 1 when every finding merely confirms a default", () => {
    const result = parseGaReview(ROUND_ONE.replace("resolution: decide", "resolution: assume"));

    expect(result.ok && derivedDecision(result.review.findings, 1)).toBe("accept");
  });

  it("rejects a file without the decision line", () => {
    const result = parseGaReview(ROUND_ONE.replace("decision: rework\n", ""));

    expect(result).toEqual({ ok: false, error: "missing 'decision: accept|rework' line" });
  });

  it("rejects a finding whose kind is outside the closed set", () => {
    const result = parseGaReview(ROUND_ONE.replace("kind: gap", "kind: nit"));

    expect(result).toEqual({ ok: false, error: "GA-001: kind outside gap | conflict | weasel | untestable | missing_negative | unmodeled_term" });
  });

  // @covers spec-stage:DLT-014
  it("reads the severity of a finding", () => {
    const result = parseGaReview(ROUND_ONE.replace("  resolution: decide\n", "  severity: minor\n  resolution: decide\n"));

    expect(result.ok && result.review.findings[0]?.severity).toBe("minor");
  });

  // @covers spec-stage:DLT-014
  it("counts a finding without severity as major", () => {
    const result = parseGaReview(ROUND_ONE);

    expect(result.ok && result.review.findings.map((finding) => finding.severity)).toEqual(["major", "major"]);
  });

  // @covers spec-stage:DLT-014
  it("rejects a severity outside major | minor", () => {
    const result = parseGaReview(ROUND_ONE.replace("  resolution: decide\n", "  severity: blocker\n  resolution: decide\n"));

    expect(result).toEqual({ ok: false, error: "GA-001: severity must be major or minor" });
  });

  // @covers spec-stage:DLT-014
  it("derives accept in round 1 when every decide finding is minor", () => {
    const result = parseGaReview(ROUND_ONE.replace("  resolution: decide\n", "  severity: minor\n  resolution: decide\n"));

    expect(result.ok && derivedDecision(result.review.findings, 1)).toBe("accept");
  });

  // @covers spec-stage:DLT-014
  it("derives accept in round 2 when only a minor decide finding stays unapplied", () => {
    const result = parseGaReview(ROUND_TWO.replace("applied: yes", "applied: no").replace("  resolution: decide\n", "  severity: minor\n  resolution: decide\n"));

    expect(result.ok && derivedDecision(result.review.findings, 2)).toBe("accept");
  });

  it("treats an empty findings fence as a clean review", () => {
    const result = parseGaReview("# Spec review: todo-cli, round 1\n\ndecision: accept\n\n## Findings\n```yaml\n[]\n```\n");

    expect(result.ok && result.review.findings).toEqual([]);
  });
});
