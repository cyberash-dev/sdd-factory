import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { blockingSpecIds, mostUpstreamTarget, parseReviewReport } from "../../src/build-stage/domain/review-report.js";

function report(frontmatter: Readonly<Record<string, unknown>>): string {
  return `---\n${YAML.stringify(frontmatter)}---\n## Scope checked\n\n## Spec conformance\n\n## Findings\n\n## Verdict rationale\n`;
}

const base = { role: "reviewer", attempt: 1, task_id: "T-001", impl_sha: "3333333333333333333333333333333333333333", mode: "review" };
const blocking = (id: string, target: string) => ({ id, severity: "blocking", target, spec_ids: ["greeter:BEH-001"], evidence: "greeter:BEH-001.then: x; src/greet.ts:3: y" });
const advisory = { id: "RV-009", severity: "advisory", target: "implementer", spec_ids: [], evidence: "style" };

describe("review report contract", () => {
  // @covers build-stage:CTR-001
  it("accepts an approve report without findings", () => {
    const parsed = parseReviewReport(report({ ...base, decision: "approve", target: "none", findings: [] }));

    expect(parsed).toEqual({ ok: true, report: { attempt: 1, taskId: "T-001", implSha: "3333333333333333333333333333333333333333", mode: "review", decision: "approve", target: "none", findings: [] } });
  });

  it("accepts advisory_only with one advisory finding", () => {
    const parsed = parseReviewReport(report({ ...base, decision: "advisory_only", target: "none", findings: [advisory] }));

    expect(parsed.ok && parsed.report.findings.map((finding) => [finding.id, finding.severity])).toEqual([["RV-009", "advisory"]]);
  });

  it("accepts request_changes whose target is the most upstream blocking target among mixed findings", () => {
    const parsed = parseReviewReport(report({ ...base, decision: "request_changes", target: "architect", findings: [blocking("RV-001", "implementer"), blocking("RV-002", "architect"), advisory] }));

    expect(parsed.ok && [parsed.report.target, blockingSpecIds(parsed.report)]).toEqual(["architect", ["greeter:BEH-001"]]);
  });

  it("accepts arbitration mode with impl_sha null", () => {
    const parsed = parseReviewReport(report({ ...base, impl_sha: null, mode: "arbitration", decision: "request_changes", target: "test-writer", findings: [blocking("RV-001", "test-writer")] }));

    expect(parsed.ok && [parsed.report.mode, parsed.report.implSha]).toEqual(["arbitration", null]);
  });

  it.each([
    ["a missing file", null, "missing_file"],
    ["no frontmatter", "## Findings\n", "missing_frontmatter"],
    ["a verdict key instead of decision", report({ ...base, verdict: "approve", target: "none", findings: [] }), "missing_required_key:decision"],
    ["a decision outside the enum", report({ ...base, decision: "ship_it", target: "none", findings: [] }), "invalid_enum_value:decision"],
    ["a missing task_id", report({ role: "reviewer", attempt: 1, impl_sha: null, mode: "arbitration", decision: "approve", target: "none", findings: [] }), "missing_required_key:task_id"],
    ["a missing impl_sha key", report({ role: "reviewer", attempt: 1, task_id: "T-001", mode: "review", decision: "approve", target: "none", findings: [] }), "missing_required_key:impl_sha"],
    ["a mode outside the enum", report({ ...base, mode: "audit", decision: "approve", target: "none", findings: [] }), "invalid_enum_value:mode"],
    ["request_changes with zero blocking findings", report({ ...base, decision: "request_changes", target: "implementer", findings: [advisory] }), "postcondition_violated:decision request_changes iff a blocking finding exists"],
    ["approve with a finding", report({ ...base, decision: "approve", target: "none", findings: [advisory] }), "postcondition_violated:decision approve iff findings is empty"],
    ["a target with a non-request_changes decision", report({ ...base, decision: "approve", target: "implementer", findings: [] }), "postcondition_violated:target none iff decision is not request_changes"],
    ["request_changes with target none", report({ ...base, decision: "request_changes", target: "none", findings: [blocking("RV-001", "implementer")] }), "postcondition_violated:target none iff decision is not request_changes"],
    ["a target that is not the most upstream", report({ ...base, decision: "request_changes", target: "implementer", findings: [blocking("RV-001", "implementer"), blocking("RV-002", "contract")] }), "postcondition_violated:target is not the most upstream blocking target"],
    ["a finding id outside the RV- grammar", report({ ...base, decision: "request_changes", target: "implementer", findings: [{ ...blocking("F-1", "implementer") }] }), "invalid_enum_value:findings[0].id"],
    ["duplicate finding ids", report({ ...base, decision: "request_changes", target: "implementer", findings: [blocking("RV-001", "implementer"), blocking("RV-001", "implementer")] }), "invalid_enum_value:findings[].id duplicated"],
  ])("rejects %s as unparseable", (_label, text, error) => {
    expect(parseReviewReport(text)).toEqual({ ok: false, error });
  });

  it("orders targets contract > architect > test-writer > implementer", () => {
    const findings = [
      { id: "RV-001", severity: "blocking", target: "implementer", specIds: [], evidence: "" },
      { id: "RV-002", severity: "blocking", target: "test-writer", specIds: [], evidence: "" },
      { id: "RV-003", severity: "advisory", target: "contract", specIds: [], evidence: "" },
    ] as const;

    expect(mostUpstreamTarget(findings)).toBe("test-writer");
  });
});
