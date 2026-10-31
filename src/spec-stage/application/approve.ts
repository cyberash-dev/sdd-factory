import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { specGateReworks } from "../../bus/domain/run-state.js";
import type { Effect, PendingEvent } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import { parseFinalizeEnvelope } from "../../shared/sdd/envelope.js";
import type { SliceContext } from "../../shared/slice.js";
import { lintGateFailures, recordGateFailure, textGateFailure } from "../domain/gate-failures.js";
import { renderGateFindings, type GateFailure } from "../domain/gate-findings.js";
import { specIntegrityProblems, specIntegrityWarnings } from "../domain/spec-records.js";
import { probeApproval, type ProbeFinding } from "./approval-probe.js";
import { repairSpecForApproval } from "./approval-repairs.js";
import { concludeStage, outputTail, specBlocked, type StageDeps } from "./stage-deps.js";
import { lintProductSpecWithFix } from "./spec-lint.js";

const APPROVAL_MODE = "pre-authorized-at-launch";

const GATE_FINDINGS_PATH = "spec/review/gate.md";

const RECORD_FILES: readonly string[] = ["spec/spec.md", "spec/assumptions.md"];

const PLANS_DIR = join(".sdd", "plans");

interface GateReport {
  readonly detail: string;
  readonly failures: readonly GateFailure[];
}

type ApprovalOutcome = { readonly kind: "approved"; readonly approvedIds: number } | { readonly kind: "failed"; readonly report: GateReport };

function approveArgv(slice: SliceContext, id: string): readonly string[] {
  return ["approve", "--id", id, "--approver", slice.operator, "--owner-role", "product-owner", "--change-request", `${slice.runId}: pre-authorised at launch`, "--scope", "first-time-approval", "--format=json"];
}

function textReport(label: string, text: string): GateReport {
  const detail = `${label}: ${text}`;
  return { detail, failures: [textGateFailure("gap", detail)] };
}

async function recordFiles(productDir: string): Promise<ReadonlyMap<string, string>> {
  const texts = await Promise.all(RECORD_FILES.map(async (file) => [file, (await readTextOrNull(join(productDir, file))) ?? ""] as const));
  return new Map(texts);
}

async function lintReport(slice: SliceContext, deps: StageDeps, context: EffectContext): Promise<GateReport | null> {
  const lint = await lintProductSpecWithFix(slice, deps, context);
  if (lint.exitCode === 0) {
    return null;
  }
  return { detail: `lint_failed: ${outputTail(lint)}`, failures: lintGateFailures(`${lint.stdout}\n${lint.stderr}`, await recordFiles(slice.paths.productDir)) };
}

function integrityReport(slice: SliceContext, specText: string): GateReport | null {
  for (const warning of specIntegrityWarnings(specText)) {
    slice.log(`warning: spec_integrity: ${warning}`);
  }
  const problems = specIntegrityProblems(specText);
  return problems.length === 0 ? null : { detail: `spec_integrity: ${problems.join("; ")}`, failures: problems.map((problem) => textGateFailure("conflict", `spec_integrity: ${problem}`)) };
}

function probeText(finding: ProbeFinding): string {
  return `${finding.kind}: ${finding.message}`;
}

/* spec-stage:DLT-010: a structural defect `sdd ready` sees only on approved records goes back to the analyst while the records are still editable. */
async function probeReport(slice: SliceContext, deps: StageDeps, approvals: readonly (readonly string[])[]): Promise<GateReport | null> {
  const findings = await probeApproval(slice, deps, approvals);
  if (findings.length === 0) {
    return null;
  }
  return {
    detail: `approval_probe: ${findings.map(probeText).join("; ")}`,
    failures: findings.map((finding) => recordGateFailure(finding.recordId, probeText(finding))),
  };
}

async function approveAndFinalize(slice: SliceContext, deps: StageDeps, approveAll: readonly string[], approveBaseline: readonly string[]): Promise<ApprovalOutcome> {
  const productDir = slice.paths.productDir;
  const all = await deps.commands.run(approveAll, productDir);
  if (all.exitCode !== 0) {
    return { kind: "failed", report: textReport("approve_failed", outputTail(all)) };
  }
  const baseline = await deps.commands.run(approveBaseline, productDir);
  if (baseline.exitCode !== 0 && !baseline.stdout.includes("no-id-match")) {
    return { kind: "failed", report: textReport("approve_failed", outputTail(baseline)) };
  }
  const finalize = await deps.commands.run(["finalize", "--format=json"], productDir);
  if (finalize.exitCode !== 0) {
    return { kind: "failed", report: textReport("finalize_failed", outputTail(finalize)) };
  }
  const finalized = parseFinalizeEnvelope(finalize.stdout);
  return finalized.ok ? { kind: "approved", approvedIds: finalized.flipped.length } : { kind: "failed", report: textReport("finalize_failed", finalized.kind ?? outputTail(finalize)) };
}

/* Attestations of a refused approval would otherwise join the approval of the redraft. */
async function removeQueuedPlan(productDir: string): Promise<void> {
  const plansDir = join(productDir, PLANS_DIR);
  const planId = ((await readTextOrNull(join(plansDir, ".active"))) ?? "").trim();
  if (planId !== "") {
    await rm(join(plansDir, `${planId}.yaml`), { force: true });
  }
  await rm(join(plansDir, ".active"), { force: true });
}

/* spec-stage:DLT-011: the failure goes to the analyst as spec/review/gate.md; the transition decides between a redraft and the block. */
async function reportGateFailure(context: EffectContext, slice: SliceContext, deps: StageDeps, report: GateReport): Promise<void> {
  const failures = report.failures.length > 0 ? report.failures : [textGateFailure("gap", report.detail)];
  const gatePath = join(slice.paths.productDir, GATE_FINDINGS_PATH);
  await mkdir(dirname(gatePath), { recursive: true });
  await writeFile(gatePath, renderGateFindings(slice.slug, context.state.stageAttempts.criticRounds, failures), "utf8");
  const gateFailed: PendingEvent = { type: "spec.gate_failed", producer: "foreman", payload: { findingsPath: GATE_FINDINGS_PATH, detail: report.detail } };
  /* At the cap the transition blocks the stage, so its clock stops with this event. */
  if (specGateReworks(context.state) >= slice.config.caps.specGateReworks) {
    concludeStage(deps, context, gateFailed);
    return;
  }
  context.publish(gateFailed);
}

export async function runApprove(_effect: Effect, context: EffectContext, slice: SliceContext, deps: StageDeps): Promise<void> {
  const specText = await repairSpecForApproval(slice, deps);
  const approveAll = approveArgv(slice, `${slice.slug}:*`);
  const approveBaseline = approveArgv(slice, `${slice.slug}:BL-001`);
  const preApproval = (await lintReport(slice, deps, context)) ?? integrityReport(slice, specText) ?? (await probeReport(slice, deps, [approveAll, approveBaseline]));
  if (preApproval !== null) {
    await reportGateFailure(context, slice, deps, preApproval);
    return;
  }
  const approval = await approveAndFinalize(slice, deps, approveAll, approveBaseline);
  if (approval.kind === "failed") {
    await removeQueuedPlan(slice.paths.productDir);
    await reportGateFailure(context, slice, deps, approval.report);
    return;
  }
  /* Records are approved and frozen here (spec-stage:BEH-004), so a redraft cannot repair them. */
  const lintAfter = await lintProductSpecWithFix(slice, deps, context);
  if (lintAfter.exitCode !== 0) {
    concludeStage(deps, context, specBlocked("foreman", "analyst_blocked", `lint_failed_after_finalize: ${outputTail(lintAfter)}`));
    return;
  }
  slice.log(`spec approved: ${approval.approvedIds} records flipped by ${slice.operator}`);
  concludeStage(deps, context, { type: "spec.approved", producer: "foreman", payload: { approver: slice.operator, mode: APPROVAL_MODE, approvedIds: approval.approvedIds } });
}
