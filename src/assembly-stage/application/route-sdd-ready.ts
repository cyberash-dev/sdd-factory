import type { TaskState } from "../../bus/domain/run-state.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { EffectHandler } from "../../shared/slice.js";
import { tasksCovering, tasksWriting, uniqueSorted } from "../domain/attribution.js";
import { ASSEMBLY_EFFECT } from "../domain/effects.js";
import { integerField, stringField } from "../domain/payload.js";
import { sddReadyReason, uncoveredWithoutOwnerReason } from "../domain/rework-reasons.js";
import { plannerRecutEvent, reworkEvents } from "../domain/rules/emit.js";
import { parseReadyEnvelope, SddEnvelopeError, type ReadyEnvelope, type ReadyViolation } from "../../shared/sdd/envelope.js";
import { ROUTED_BY_FILE_KINDS, ROUTED_BY_ID_KINDS, SPEC_GATE_KINDS } from "../domain/sdd-ready-routing.js";
import { updateLedger, writeFailedReport } from "./ledger-store.js";

function envelopeOf(text: string): ReadyEnvelope | null {
  try {
    return parseReadyEnvelope(text);
  } catch (error) {
    if (error instanceof SddEnvelopeError) {
      return null;
    }
    throw error;
  }
}

function ownersOf(tasks: Readonly<Record<string, TaskState>>, violation: ReadyViolation): readonly string[] {
  if (ROUTED_BY_ID_KINDS.includes(violation.kind)) {
    return violation.id === null ? [] : tasksCovering(tasks, violation.id);
  }
  if (ROUTED_BY_FILE_KINDS.includes(violation.kind)) {
    return violation.file === null ? [] : tasksWriting(tasks, violation.file);
  }
  return [];
}

export function routeSddReadyEffect(triage: EffectHandler): EffectHandler {
  return async (effect, context, slice) => {
    const round = integerField(effect, "round");
    const evidencePath = stringField(effect, "evidencePath");
    const identity = { runDir: slice.paths.runDir, runId: slice.runId, slug: slice.slug };
    const summary = envelopeOf((await readTextOrNull(evidencePath)) ?? "");
    const tasks = context.state.tasks;
    const reasonsByTask = new Map<string, string[]>();
    const unownedIds: string[] = [];
    let needsTriage = summary === null;
    for (const violation of summary?.violations ?? []) {
      if (SPEC_GATE_KINDS.includes(violation.kind)) {
        const detail = `spec_gate: ${violation.kind} ${violation.id ?? ""}`.trim();
        await writeFailedReport(slice.paths, identity, detail);
        context.publish({ type: "run.failed", producer: "assembler", payload: { stage: "assembly", reason: "runtime_error", detail } });
        return;
      }
      const owners = ownersOf(tasks, violation);
      if (owners.length === 0) {
        if (violation.kind === "uncovered" && violation.id !== null) {
          unownedIds.push(violation.id);
        } else {
          needsTriage = true;
        }
        continue;
      }
      for (const owner of owners) {
        reasonsByTask.set(owner, [...(reasonsByTask.get(owner) ?? []), sddReadyReason(violation.kind, violation.id ?? violation.file ?? "")]);
      }
    }
    const routed = [...reasonsByTask].sort(([left], [right]) => left.localeCompare(right));
    for (const [taskId, reasons] of routed) {
      for (const pending of reworkEvents({ state: context.state, round, taskId, target: "test-writer", reason: reasons.join("; "), findingPath: evidencePath })) {
        context.publish(pending);
      }
    }
    if (routed.length > 0) {
      await updateLedger(identity, (ledger) => ({ ...ledger, reworks: [...ledger.reworks, ...routed.map(([task_id]) => ({ round, task_id, target: "test-writer" as const, source: "sdd_ready" as const }))] }));
    }
    if (unownedIds.length > 0) {
      context.publish(plannerRecutEvent(context.state, uncoveredWithoutOwnerReason(uniqueSorted(unownedIds))));
    }
    if (needsTriage) {
      await triage({ kind: ASSEMBLY_EFFECT.triage, round, step: "sdd_ready", evidencePath }, context, slice);
    }
  };
}
