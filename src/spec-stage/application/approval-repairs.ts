import { join } from "node:path";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { appendAssumptions, nextAssumptionNumber, renderDefaultAssumption } from "../domain/assumption-records.js";
import { lintGateFailures } from "../domain/gate-failures.js";
import { openQuestionsDecidableByDefault, parseSpecRecords, repairSurfaceMembers } from "../domain/spec-records.js";
import { applyRepairUnlessLintRegresses } from "./repair-guard.js";
import { lintProductSpec } from "./spec-lint.js";
import type { StageDeps } from "./stage-deps.js";

/* spec-stage:DLT-009: the failures the gate would report, so a fence the repair makes unparseable counts although sdd lint skips it. */
async function lintErrorCount(deps: StageDeps, productDir: string): Promise<number> {
  const lint = await lintProductSpec(deps.commands, productDir);
  return lintGateFailures(`${lint.stdout}\n${lint.stderr}`, new Map()).length;
}

function guardedRepair(slice: SliceContext, deps: StageDeps, name: string, original: string, repaired: string): Promise<string> {
  return applyRepairUnlessLintRegresses({
    name,
    specPath: join(slice.paths.productDir, "spec", "spec.md"),
    original,
    repaired,
    lintErrors: () => lintErrorCount(deps, slice.paths.productDir),
    log: (line) => slice.log(line),
  });
}

/* spec-stage:DLT-003: an Open-Q the critic left undecided is decided by its own default before approval. */
async function decideByDefault(slice: SliceContext, deps: StageDeps, specText: string): Promise<string> {
  const undecided = openQuestionsDecidableByDefault(parseSpecRecords(specText));
  if (undecided.length === 0) {
    return specText;
  }
  const first = nextAssumptionNumber(slice.slug, [specText]);
  const reviewBy = slice.now().toISOString().slice(0, 10);
  const rendered = undecided.map((openQuestion, index) => renderDefaultAssumption({ slug: slice.slug, number: first + index, openQuestion, reviewBy }));
  const decided = appendAssumptions(specText, slice.slug, rendered.map((assumption) => assumption.block));
  const kept = await guardedRepair(slice, deps, "decide by default", specText, decided);
  if (kept === decided) {
    slice.log(`spec.approve: ${undecided.map((openQuestion) => openQuestion.id).join(", ")} decided by default_if_unresolved as ${rendered.map((assumption) => assumption.id).join(", ")}`);
  }
  return kept;
}

/* spec-stage:DLT-004, DLT-007, DLT-008: a Contract or a boundary surface_ref record absent from the single Surface's members is appended, a surface_ref record without boundary fields is detached; zero or several Surfaces stay for the integrity check. */
async function repairMembers(slice: SliceContext, deps: StageDeps, specText: string): Promise<string> {
  const repair = repairSurfaceMembers(specText);
  if (repair === null || repair.text === specText) {
    return specText;
  }
  const kept = await guardedRepair(slice, deps, "surface members", specText, repair.text);
  if (kept === repair.text && repair.added.length > 0) {
    slice.log(`spec.approve: ${repair.surfaceId} members += ${repair.added.join(", ")}`);
  }
  if (kept === repair.text && repair.detached.length > 0) {
    slice.log(`spec.approve: ${repair.surfaceId} surface_ref removed from ${repair.detached.join(", ")}`);
  }
  return kept;
}

/* The mechanical repairs before the pre-authorised approval; returns the spec text left on disk. */
export async function repairSpecForApproval(slice: SliceContext, deps: StageDeps): Promise<string> {
  const specText = (await readTextOrNull(join(slice.paths.productDir, "spec", "spec.md"))) ?? "";
  return repairMembers(slice, deps, await decideByDefault(slice, deps, specText));
}
