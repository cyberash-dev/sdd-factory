import { describe, expect, it } from "vitest";
import { lintGateFailures, recordGateFailure, textGateFailure } from "./gate-failures.js";

const SPEC = `## 7. Data contracts
\`\`\`yaml
---
id: todo:CTR-001
type: Contract
title: todo add <text>
---
\`\`\`

## 15. Implementation bindings
\`\`\`yaml
---
id: todo:IB-001
type: ImplementationBinding
title: CLI entry bound to dist/cli.js
---
\`\`\`
`;

function lintEnvelope(diagnostics: readonly Readonly<Record<string, unknown>>[]): string {
  return JSON.stringify({ format_version: 1, ok: diagnostics.length === 0, error_count: diagnostics.length, warn_count: 0, diagnostics });
}

describe("approval gate failures", () => {
  // @covers spec-stage:DLT-011
  it("targets the record id a lint message quotes and keeps the rule id and line in the text", () => {
    const output = lintEnvelope([{ severity: "error", rule: "sdd:boundary-policy-ref", file: "spec/spec.md", line: 1843, message: 'Boundary ImplementationBinding "todo:IB-001" must declare policy_refs' }]);

    const failures = lintGateFailures(output, new Map());

    expect(failures).toEqual([{ kind: "gap", targetIds: ["todo:IB-001"], text: 'sdd:boundary-policy-ref at spec/spec.md:1843: Boundary ImplementationBinding "todo:IB-001" must declare policy_refs' }]);
  });

  // @covers spec-stage:DLT-011
  it("targets the record whose fence holds the diagnostic line when the message quotes no record id", () => {
    const output = lintEnvelope([{ severity: "error", rule: "sdd:weasel-word", file: "spec/spec.md", line: 15, message: "weasel word 'should' in a normative section" }]);

    const failures = lintGateFailures(output, new Map([["spec/spec.md", SPEC]]));

    expect(failures.map((failure) => failure.targetIds)).toEqual([["todo:IB-001"]]);
  });

  // @covers spec-stage:DLT-011
  it("targets no record when the diagnostic line lies outside every record fence", () => {
    const output = lintEnvelope([{ severity: "error", rule: "sdd:weasel-word", file: "spec/spec.md", line: 10, message: "weasel word 'should' in a normative section" }]);

    const failures = lintGateFailures(output, new Map([["spec/spec.md", SPEC]]));

    expect(failures.map((failure) => failure.targetIds)).toEqual([[]]);
  });

  // @covers spec-stage:DLT-011
  it("leaves warnings out of the gate failures", () => {
    const output = lintEnvelope([
      { severity: "warn", rule: "sdd:long-title", file: "spec/spec.md", line: 4, message: 'title of "todo:CTR-001" is long' },
      { severity: "error", rule: "sdd:required-field", file: "spec/spec.md", line: 15, message: '"todo:IB-001" lacks title' },
    ]);

    const failures = lintGateFailures(output, new Map());

    expect(failures.map((failure) => failure.targetIds)).toEqual([["todo:IB-001"]]);
  });

  // @covers spec-stage:DLT-011
  it("turns a yaml_invalid line after the lint envelope into a failure targeting the record it names", () => {
    const output = `${lintEnvelope([])}\nyaml_invalid todo:CTR-001 (spec/spec.md, record at line 4): Nested mappings are not allowed in compact mappings\n`;

    const failures = lintGateFailures(output, new Map());

    expect(failures).toEqual([{ kind: "gap", targetIds: ["todo:CTR-001"], text: "yaml_invalid todo:CTR-001 (spec/spec.md, record at line 4): Nested mappings are not allowed in compact mappings" }]);
  });

  // @covers spec-stage:DLT-011
  it("keeps lint output that is no envelope as one failure without a target", () => {
    const failures = lintGateFailures("sdd:weasel-word at line 9\n", new Map());

    expect(failures).toEqual([{ kind: "gap", targetIds: [], text: "sdd:weasel-word at line 9" }]);
  });

  // @covers spec-stage:DLT-010
  it("targets the record a probe finding names", () => {
    const failure = recordGateFailure("todo:BEH-003", "surface_member_drift: add record todo:BEH-003 to members");

    expect(failure).toEqual({ kind: "gap", targetIds: ["todo:BEH-003"], text: "surface_member_drift: add record todo:BEH-003 to members" });
  });

  // @covers spec-stage:DLT-010
  it("targets the record a probe message quotes when the finding names no record", () => {
    const failure = recordGateFailure(null, 'aggregated_lint: Boundary ImplementationBinding "todo:IB-001" must declare policy_refs');

    expect(failure.targetIds).toEqual(["todo:IB-001"]);
  });

  // @covers spec-stage:DLT-011
  it("targets every record an integrity problem names", () => {
    const failure = textGateFailure("conflict", "spec_integrity: todo:CTR-001 is not a member of todo:SUR-001");

    expect(failure).toEqual({ kind: "conflict", targetIds: ["todo:CTR-001", "todo:SUR-001"], text: "spec_integrity: todo:CTR-001 is not a member of todo:SUR-001" });
  });

  // @covers spec-stage:DLT-011
  it("targets no record for an integrity problem without a record id", () => {
    const failure = textGateFailure("conflict", "spec_integrity: expected exactly one Surface, found 2");

    expect(failure.targetIds).toEqual([]);
  });
});
