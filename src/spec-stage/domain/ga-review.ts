import YAML from "yaml";
import { isRecord, isStringArray } from "./guards.js";

export const GA_FINDING_KINDS = ["gap", "conflict", "weasel", "untestable", "missing_negative", "unmodeled_term"] as const;

export type GaFindingKind = (typeof GA_FINDING_KINDS)[number];

export type ReviewDecision = "accept" | "rework";

export type GaSeverity = "major" | "minor";

export interface GaFinding {
  readonly id: string;
  readonly kind: GaFindingKind;
  readonly targetIds: readonly string[];
  readonly severity: GaSeverity;
  readonly resolution: "decide" | "assume";
  readonly requiredChange: string;
  readonly assumption: string | null;
  readonly applied: boolean | null;
}

export interface GaReview {
  readonly slug: string;
  readonly round: number;
  readonly decision: ReviewDecision;
  readonly findings: readonly GaFinding[];
}

export type GaReviewResult = { readonly ok: true; readonly review: GaReview } | { readonly ok: false; readonly error: string };

const HEADER = /^# Spec review: (\S+), round ([0-9]+)\s*$/m;
const DECISION_LINE = /^decision:\s*(accept|rework)\s*$/m;
const FINDINGS_FENCE = /^## Findings\s*\n(?:[^\n]*\n)*?```ya?ml\s*\n([\s\S]*?)\n```/m;
const FINDING_ID = /^GA-[0-9]{3}$/;

function isFindingKind(value: unknown): value is GaFindingKind {
  return typeof value === "string" && (GA_FINDING_KINDS as readonly string[]).includes(value);
}

function appliedOf(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === true || value === "yes") {
    return true;
  }
  if (value === false || value === "no") {
    return false;
  }
  return undefined;
}

/* spec-stage:DLT-014: a finding without severity counts as major. */
function severityOf(value: unknown): GaSeverity | undefined {
  if (value === undefined || value === null) {
    return "major";
  }
  return value === "major" || value === "minor" ? value : undefined;
}

function parseFinding(raw: unknown, index: number): GaFinding | string {
  if (!isRecord(raw)) {
    return `finding ${index} is not a mapping`;
  }
  const id = raw["id"];
  if (typeof id !== "string" || !FINDING_ID.test(id)) {
    return `finding ${index} has no id matching GA-NNN`;
  }
  const kind = raw["kind"];
  if (!isFindingKind(kind)) {
    return `${id}: kind outside ${GA_FINDING_KINDS.join(" | ")}`;
  }
  const targetIds = raw["target_ids"];
  if (!isStringArray(targetIds)) {
    return `${id}: target_ids must be a list of record ids`;
  }
  const severity = severityOf(raw["severity"]);
  if (severity === undefined) {
    return `${id}: severity must be major or minor`;
  }
  const resolution = raw["resolution"];
  if (resolution !== "decide" && resolution !== "assume") {
    return `${id}: resolution must be decide or assume`;
  }
  const requiredChange = raw["required_change"];
  if (typeof requiredChange !== "string") {
    return `${id}: required_change must be text`;
  }
  const applied = appliedOf(raw["applied"]);
  if (applied === undefined) {
    return `${id}: applied must be yes or no`;
  }
  const assumption = typeof raw["assumption"] === "string" ? raw["assumption"] : null;
  return { id, kind, targetIds, severity, resolution, requiredChange, assumption, applied };
}

export function findingsYaml(text: string): string | null {
  const fence = FINDINGS_FENCE.exec(text);
  return fence === null ? null : (fence[1] ?? "");
}

function parseFindings(text: string): readonly GaFinding[] | string {
  const yaml = findingsYaml(text);
  if (yaml === null) {
    return "missing '## Findings' section with a yaml fence";
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(yaml);
  } catch (error) {
    return `findings yaml does not parse: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (parsed === null || parsed === undefined) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return "findings yaml must be a list";
  }
  const findings: GaFinding[] = [];
  for (const [index, raw] of parsed.entries()) {
    const finding = parseFinding(raw, index + 1);
    if (typeof finding === "string") {
      return finding;
    }
    findings.push(finding);
  }
  return findings;
}

export function parseGaReview(text: string): GaReviewResult {
  const header = HEADER.exec(text);
  if (header === null) {
    return { ok: false, error: "missing header '# Spec review: <slug>, round <n>'" };
  }
  const decisionLine = DECISION_LINE.exec(text);
  if (decisionLine === null) {
    return { ok: false, error: "missing 'decision: accept|rework' line" };
  }
  const findings = parseFindings(text);
  if (typeof findings === "string") {
    return { ok: false, error: findings };
  }
  const decision: ReviewDecision = decisionLine[1] === "accept" ? "accept" : "rework";
  return { ok: true, review: { slug: header[1] ?? "", round: Number(header[2]), decision, findings } };
}

export function isOpenDecision(finding: GaFinding, round: number): boolean {
  return finding.resolution === "decide" && (round === 1 || finding.applied !== true);
}

/* spec-stage:DLT-014: only an open major decide finding sends the spec back to the analyst. */
export function derivedDecision(findings: readonly GaFinding[], round: number): ReviewDecision {
  return findings.some((finding) => finding.severity === "major" && isOpenDecision(finding, round)) ? "rework" : "accept";
}
