import { describe, expect, it } from "vitest";
import { describeHandoffError, HANDOFF_ROLES, parseHandoff, type HandoffRole } from "./handoff.js";

const COMPLETE_FRONTMATTER: Readonly<Record<HandoffRole, string>> = {
  "spec-analyst": "role: spec-analyst\nattempt: 1\nstatus: complete\nlint_exit: 0\nrecords: {behaviors: 2, contracts: 1}\n",
  "spec-critic": "role: spec-critic\nattempt: 1\nstatus: complete\ndecision: accept\nfindings: []\nassumptions_added: []\n",
  architect: "role: architect\nattempt: 1\nstatus: complete\nmodules: [{id: M-01, name: cli, covers: []}]\ntooling: {node: '>=22'}\n",
  "verification-designer": "role: verification-designer\nattempt: 1\nstatus: complete\nobligations: []\n",
  planner: "role: planner\nattempt: 1\nstatus: complete\ntasks_path: design/tasks.json\ntask_count: 2\nuncovered_ids: []\n",
  "test-writer": "role: test-writer\nattempt: 1\nstatus: complete\ntest_files: [tests/cli/add.test.ts]\ncovers: ['todo-cli:BEH-001']\n",
  implementer: "role: implementer\nattempt: 2\nstatus: complete\nchanged_files: [src/cli/add.ts]\n",
  reviewer: "role: reviewer\nattempt: 1\ndecision: approve\ntarget: none\nfindings: []\n",
  triage: "role: triage\nattempt: 1\nstatus: complete\nroute: {task_id: T-001, target: implementer, reason: compile error}\n",
};

const REQUIRED_KEYS: Readonly<Record<HandoffRole, readonly string[]>> = {
  "spec-analyst": ["status", "lint_exit", "records"],
  "spec-critic": ["status", "decision", "findings", "assumptions_added"],
  architect: ["status", "modules", "tooling"],
  "verification-designer": ["status", "obligations"],
  planner: ["status", "tasks_path", "task_count", "uncovered_ids"],
  "test-writer": ["status", "test_files", "covers"],
  implementer: ["status", "changed_files"],
  reviewer: ["decision", "target", "findings"],
  triage: ["status", "route"],
};

function fileWith(frontmatter: string, body = "summary line\n"): string {
  return `---\n${frontmatter}---\n${body}`;
}

function withoutKey(frontmatter: string, key: string): string {
  return frontmatter
    .split("\n")
    .filter((line) => !line.startsWith(`${key}:`))
    .join("\n");
}

function outcome(role: HandoffRole, text: string | null): string {
  const result = parseHandoff(role, text);
  return result.ok ? "ok" : describeHandoffError(result.error);
}

describe("handoff frontmatter protocol", () => {
  // @covers bus:CTR-007
  it.each(HANDOFF_ROLES)("parses a complete %s handoff into role, attempt and frontmatter", (role) => {
    const result = parseHandoff(role, fileWith(COMPLETE_FRONTMATTER[role]));

    expect(result.ok && [result.handoff.role, result.handoff.attempt, result.handoff.body]).toEqual([role, role === "implementer" ? 2 : 1, "summary line\n"]);
  });

  it.each(HANDOFF_ROLES.flatMap((role) => REQUIRED_KEYS[role].map((key) => [role, key] as const)))(
    "reports missing_required_key for %s without %s",
    (role, key) => {
      expect(outcome(role, fileWith(withoutKey(COMPLETE_FRONTMATTER[role], key)))).toBe(`missing_required_key:${key}`);
    },
  );

  it.each([
    ["reviewer", "role: reviewer\nattempt: 1\ndecision: maybe\ntarget: none\nfindings: []\n", "decision"],
    ["reviewer", "role: reviewer\nattempt: 1\ndecision: approve\ntarget: foreman\nfindings: []\n", "target"],
    ["spec-critic", "role: spec-critic\nattempt: 1\nstatus: complete\ndecision: later\nfindings: []\nassumptions_added: []\n", "decision"],
    ["implementer", "role: implementer\nattempt: 1\nstatus: done\nchanged_files: []\n", "status"],
    ["implementer", "role: implementer\nattempt: 1\nstatus: finding\nchanged_files: []\nfinding: {type: BUG, spec_ids: [], detail: x}\n", "finding.type"],
    ["triage", "role: triage\nattempt: 1\nstatus: complete\nroute: {task_id: null, target: architect, reason: x}\n", "route.target"],
  ] as const)("reports invalid_enum_value for %s with an out-of-enum %s", (role, frontmatter, key) => {
    expect(outcome(role, fileWith(frontmatter))).toBe(`invalid_enum_value:${key}`);
  });

  it("does not accept verdict as a substitute for the reviewer decision", () => {
    const text = fileWith("role: reviewer\nattempt: 1\nverdict: approve\ntarget: none\nfindings: []\n");

    expect(outcome("reviewer", text)).toBe("missing_required_key:decision");
  });

  it("requires blocked_reason only when the analyst status is blocked", () => {
    const blocked = fileWith("role: spec-analyst\nattempt: 1\nstatus: blocked\nlint_exit: 1\nrecords: {}\n");

    expect(outcome("spec-analyst", blocked)).toBe("missing_required_key:blocked_reason");
  });

  it("requires the finding block only when the implementer status is finding", () => {
    const finding = fileWith("role: implementer\nattempt: 1\nstatus: finding\nchanged_files: []\n");

    expect(outcome("implementer", finding)).toBe("missing_required_key:finding");
  });

  it("keeps a second --- line inside the body as body text", () => {
    const result = parseHandoff("triage", fileWith(COMPLETE_FRONTMATTER["triage"], "first\n---\nsecond\n"));

    expect(result.ok && result.handoff.body).toBe("first\n---\nsecond\n");
  });

  // @covers bus:BEH-003
  it.each([
    ["missing file", null, "missing_file"],
    ["no frontmatter", "role: triage\nattempt: 1\n", "missing_frontmatter"],
    ["unterminated frontmatter", "---\nrole: triage\nattempt: 1\n", "missing_frontmatter"],
    ["yaml parse error", "---\nrole: triage\nattempt: [\n---\n", "yaml_parse_error"],
    ["role mismatch", fileWith(COMPLETE_FRONTMATTER["planner"]), "invalid_enum_value:role"],
    ["attempt zero", "---\nrole: triage\nattempt: 0\nstatus: complete\nroute: {}\n---\n", "invalid_enum_value:attempt"],
  ] as const)("classifies %s", (_label, text, expected) => {
    expect(outcome("triage", text)).toBe(expected);
  });

  it("accepts a malformed optional key as absent", () => {
    const text = fileWith("role: test-writer\nattempt: 1\nstatus: complete\ntest_files: []\ncovers: []\nblocked_reason: {not: [a string]}\n");

    expect(outcome("test-writer", text)).toBe("ok");
  });
});
