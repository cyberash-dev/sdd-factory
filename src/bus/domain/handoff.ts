import YAML from "yaml";
import { FINDING_TYPES, REVIEW_DECISIONS, REVIEW_TARGETS, ASSEMBLY_TARGETS } from "./catalogue.js";

export const HANDOFF_ROLES = [
  "spec-analyst",
  "spec-critic",
  "architect",
  "verification-designer",
  "planner",
  "test-writer",
  "implementer",
  "reviewer",
  "triage",
] as const;

export type HandoffRole = (typeof HANDOFF_ROLES)[number];

export type HandoffErrorCode =
  | "missing_file"
  | "missing_frontmatter"
  | "yaml_parse_error"
  | "missing_required_key"
  | "invalid_enum_value";

export interface HandoffError {
  readonly code: HandoffErrorCode;
  readonly key: string | null;
}

export type Frontmatter = Readonly<Record<string, unknown>>;

export interface ParsedHandoff {
  readonly role: HandoffRole;
  readonly attempt: number;
  readonly frontmatter: Frontmatter;
  readonly body: string;
}

export type HandoffResult = { readonly ok: true; readonly handoff: ParsedHandoff } | { readonly ok: false; readonly error: HandoffError };

interface KeyRule {
  readonly key: string;
  readonly values?: readonly string[];
  readonly requiredWhen?: (frontmatter: Frontmatter) => boolean;
}

const statusIs =
  (...statuses: readonly string[]) =>
  (frontmatter: Frontmatter): boolean =>
    typeof frontmatter["status"] === "string" && statuses.includes(frontmatter["status"]);

const ROLE_RULES: Readonly<Record<HandoffRole, readonly KeyRule[]>> = {
  "spec-analyst": [
    { key: "status", values: ["complete", "blocked"] },
    { key: "lint_exit" },
    { key: "records" },
    { key: "blocked_reason", requiredWhen: statusIs("blocked") },
  ],
  "spec-critic": [
    { key: "status", values: ["complete"] },
    { key: "decision", values: ["accept", "rework"] },
    { key: "findings" },
    { key: "assumptions_added" },
  ],
  architect: [{ key: "status", values: ["complete", "blocked"] }, { key: "modules" }, { key: "tooling" }],
  "verification-designer": [{ key: "status", values: ["complete", "blocked"] }, { key: "obligations" }],
  planner: [
    { key: "status", values: ["complete", "blocked"] },
    { key: "tasks_path" },
    { key: "task_count" },
    { key: "uncovered_ids" },
  ],
  "test-writer": [
    { key: "status", values: ["complete", "blocked"] },
    { key: "test_files" },
    { key: "covers" },
    { key: "blocked_reason", requiredWhen: statusIs("blocked") },
  ],
  implementer: [
    { key: "status", values: ["complete", "blocked", "finding"] },
    { key: "changed_files" },
    { key: "finding", requiredWhen: statusIs("finding") },
  ],
  reviewer: [
    { key: "decision", values: REVIEW_DECISIONS },
    { key: "target", values: REVIEW_TARGETS },
    { key: "findings" },
  ],
  triage: [{ key: "status", values: ["complete"] }, { key: "route" }],
};

const NESTED_ENUMS: Readonly<Record<string, readonly string[]>> = {
  "finding.type": FINDING_TYPES,
  "route.target": ASSEMBLY_TARGETS,
};

function fail(code: HandoffErrorCode, key: string | null): HandoffResult {
  return { ok: false, error: { code, key } };
}

function splitFrontmatter(text: string): { readonly yamlText: string; readonly body: string } | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return null;
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) {
    return null;
  }
  return { yamlText: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkNestedEnums(frontmatter: Frontmatter): HandoffResult | null {
  for (const [path, values] of Object.entries(NESTED_ENUMS)) {
    const [parent, child] = path.split(".");
    if (parent === undefined || child === undefined) {
      continue;
    }
    const container = frontmatter[parent];
    if (!isRecord(container) || !Object.hasOwn(container, child)) {
      continue;
    }
    const value = container[child];
    if (typeof value !== "string" || !values.includes(value)) {
      return fail("invalid_enum_value", path);
    }
  }
  return null;
}

export function parseHandoff(role: HandoffRole, text: string | null): HandoffResult {
  if (text === null) {
    return fail("missing_file", null);
  }
  const split = splitFrontmatter(text);
  if (split === null) {
    return fail("missing_frontmatter", null);
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(split.yamlText);
  } catch (error) {
    return fail("yaml_parse_error", (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? null);
  }
  if (!isRecord(parsed)) {
    return fail("yaml_parse_error", null);
  }
  for (const key of ["role", "attempt"]) {
    if (!Object.hasOwn(parsed, key)) {
      return fail("missing_required_key", key);
    }
  }
  if (parsed["role"] !== role) {
    return fail("invalid_enum_value", "role");
  }
  const attempt = parsed["attempt"];
  if (!Number.isInteger(attempt) || typeof attempt !== "number" || attempt < 1) {
    return fail("invalid_enum_value", "attempt");
  }
  for (const rule of ROLE_RULES[role]) {
    const required = rule.requiredWhen === undefined || rule.requiredWhen(parsed);
    if (!Object.hasOwn(parsed, rule.key)) {
      if (required) {
        return fail("missing_required_key", rule.key);
      }
      continue;
    }
    const value = parsed[rule.key];
    if (rule.values !== undefined && (typeof value !== "string" || !rule.values.includes(value))) {
      return fail("invalid_enum_value", rule.key);
    }
  }
  const nestedFailure = checkNestedEnums(parsed);
  if (nestedFailure !== null) {
    return nestedFailure;
  }
  return { ok: true, handoff: { role, attempt, frontmatter: parsed, body: split.body } };
}

export function describeHandoffError(error: HandoffError): string {
  return error.key === null ? error.code : `${error.code}:${error.key}`;
}
