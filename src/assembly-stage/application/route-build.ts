import { readTextOrNull } from "../../shared/fs/text.js";
import type { EffectHandler } from "../../shared/slice.js";
import { tasksWriting } from "../domain/attribution.js";
import { ASSEMBLY_EFFECT } from "../domain/effects.js";
import { missingScriptsIn } from "../domain/npm-scripts.js";
import { integerField, stringField } from "../domain/payload.js";
import { missingScriptsReason } from "../domain/rework-reasons.js";
import { reworkEvents } from "../domain/rules/emit.js";
import { updateLedger } from "./ledger-store.js";

const PACKAGE_FILE = "package.json";

export function routeBuildEffect(triage: EffectHandler): EffectHandler {
  return async (effect, context, slice) => {
    const round = integerField(effect, "round");
    const evidencePath = stringField(effect, "evidencePath");
    const missing = missingScriptsIn((await readTextOrNull(evidencePath)) ?? "");
    const owners = missing.length === 0 ? [] : tasksWriting(context.state.tasks, PACKAGE_FILE);
    if (owners.length === 0) {
      await triage({ kind: ASSEMBLY_EFFECT.triage, round, step: "build", evidencePath }, context, slice);
      return;
    }
    for (const taskId of owners) {
      for (const pending of reworkEvents({ state: context.state, round, taskId, target: "implementer", reason: missingScriptsReason(missing), findingPath: evidencePath })) {
        context.publish(pending);
      }
    }
    const identity = { runDir: slice.paths.runDir, runId: slice.runId, slug: slice.slug };
    await updateLedger(identity, (ledger) => ({ ...ledger, reworks: [...ledger.reworks, ...owners.map((task_id) => ({ round, task_id, target: "implementer" as const, source: "attribution" as const }))] }));
  };
}
