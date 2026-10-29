import { REVIEW_DECISIONS, REVIEW_TARGETS } from "../../bus/domain/catalogue.js";
import { describeHandoffError, parseHandoff, type Frontmatter } from "../../bus/domain/handoff.js";

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];
export type ReviewMode = "review" | "arbitration";
export type FindingSeverity = "blocking" | "advisory";

export interface ReviewFinding {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly target: ReviewTarget;
  readonly specIds: readonly string[];
  readonly evidence: string;
}

export interface ReviewReport {
  readonly attempt: number;
  readonly taskId: string;
  readonly implSha: string | null;
  readonly mode: ReviewMode;
  readonly decision: ReviewDecision;
  readonly target: ReviewTarget;
  readonly findings: readonly ReviewFinding[];
}

export type ReviewReportResult = { readonly ok: true; readonly report: ReviewReport } | { readonly ok: false; readonly error: string };

/* Most upstream first: the reviewer routes to the earliest owner among its blocking findings. */
export const TARGET_PRECEDENCE: readonly ReviewTarget[] = ["contract", "architect", "test-writer", "implementer"];

const SHA = /^[0-9a-f]{40}$/;
const FINDING_ID = /^RV-[0-9]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDecision(value: unknown): value is ReviewDecision {
  return typeof value === "string" && (REVIEW_DECISIONS as readonly string[]).includes(value);
}

function isTarget(value: unknown): value is ReviewTarget {
  return typeof value === "string" && (REVIEW_TARGETS as readonly string[]).includes(value);
}

function parseFinding(value: unknown, index: number): ReviewFinding | string {
  if (!isRecord(value)) {
    return `invalid_enum_value:findings[${index}]`;
  }
  const { id, severity, target, spec_ids: specIds, evidence } = value;
  if (typeof id !== "string" || !FINDING_ID.test(id)) {
    return `invalid_enum_value:findings[${index}].id`;
  }
  if (severity !== "blocking" && severity !== "advisory") {
    return `invalid_enum_value:findings[${index}].severity`;
  }
  if (!isTarget(target)) {
    return `invalid_enum_value:findings[${index}].target`;
  }
  if (!Array.isArray(specIds) || !specIds.every((item) => typeof item === "string")) {
    return `missing_required_key:findings[${index}].spec_ids`;
  }
  if (typeof evidence !== "string") {
    return `missing_required_key:findings[${index}].evidence`;
  }
  return { id, severity, target, specIds, evidence };
}

function parseFindings(value: unknown): readonly ReviewFinding[] | string {
  if (!Array.isArray(value)) {
    return "missing_required_key:findings";
  }
  const findings: ReviewFinding[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseFinding(item, index);
    if (typeof parsed === "string") {
      return parsed;
    }
    findings.push(parsed);
  }
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length) {
    return "invalid_enum_value:findings[].id duplicated";
  }
  return findings;
}

export function mostUpstreamTarget(findings: readonly ReviewFinding[]): ReviewTarget | null {
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  return TARGET_PRECEDENCE.find((target) => blocking.some((finding) => finding.target === target)) ?? null;
}

function postconditionViolation(decision: ReviewDecision, target: ReviewTarget, findings: readonly ReviewFinding[]): string | null {
  const blocking = findings.filter((finding) => finding.severity === "blocking").length;
  const advisory = findings.length - blocking;
  if ((decision === "request_changes") !== blocking >= 1) {
    return "postcondition_violated:decision request_changes iff a blocking finding exists";
  }
  if ((decision === "approve") !== (findings.length === 0)) {
    return "postcondition_violated:decision approve iff findings is empty";
  }
  if ((decision === "advisory_only") !== (blocking === 0 && advisory >= 1)) {
    return "postcondition_violated:decision advisory_only iff only advisory findings exist";
  }
  if ((target === "none") !== (decision !== "request_changes")) {
    return "postcondition_violated:target none iff decision is not request_changes";
  }
  if (decision === "request_changes" && target !== mostUpstreamTarget(findings)) {
    return "postcondition_violated:target is not the most upstream blocking target";
  }
  return null;
}

function reportFields(frontmatter: Frontmatter): { readonly taskId: string; readonly implSha: string | null; readonly mode: ReviewMode } | string {
  const taskId = frontmatter["task_id"];
  if (typeof taskId !== "string") {
    return "missing_required_key:task_id";
  }
  if (!Object.hasOwn(frontmatter, "impl_sha")) {
    return "missing_required_key:impl_sha";
  }
  const implSha = frontmatter["impl_sha"];
  if (implSha !== null && (typeof implSha !== "string" || !SHA.test(implSha))) {
    return "invalid_enum_value:impl_sha";
  }
  const mode = frontmatter["mode"];
  if (mode !== "review" && mode !== "arbitration") {
    return "invalid_enum_value:mode";
  }
  return { taskId, implSha, mode };
}

export function parseReviewReport(text: string | null): ReviewReportResult {
  const handoff = parseHandoff("reviewer", text);
  if (!handoff.ok) {
    return { ok: false, error: describeHandoffError(handoff.error) };
  }
  const frontmatter = handoff.handoff.frontmatter;
  const fields = reportFields(frontmatter);
  if (typeof fields === "string") {
    return { ok: false, error: fields };
  }
  const decision = frontmatter["decision"];
  const target = frontmatter["target"];
  if (!isDecision(decision) || !isTarget(target)) {
    return { ok: false, error: "invalid_enum_value:decision" };
  }
  const findings = parseFindings(frontmatter["findings"]);
  if (typeof findings === "string") {
    return { ok: false, error: findings };
  }
  const violation = postconditionViolation(decision, target, findings);
  if (violation !== null) {
    return { ok: false, error: violation };
  }
  return { ok: true, report: { attempt: handoff.handoff.attempt, ...fields, decision, target, findings } };
}

export function blockingSpecIds(report: ReviewReport): readonly string[] {
  return [...new Set(report.findings.filter((finding) => finding.severity === "blocking").flatMap((finding) => finding.specIds))];
}
