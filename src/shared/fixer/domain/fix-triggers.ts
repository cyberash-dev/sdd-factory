import type { FIX_OUTCOMES, FIX_OWNERS, FIX_STAGES, FIX_TRIGGERS } from "../../../bus/domain/catalogue.js";

export type FixStage = (typeof FIX_STAGES)[number];
export type FixOwner = (typeof FIX_OWNERS)[number];
export type FixTrigger = (typeof FIX_TRIGGERS)[number];
export type FixOutcome = (typeof FIX_OUTCOMES)[number];

export type GreenTrigger = "green_typecheck" | "green_load_failure";
export type AssemblyTrigger = "assembly_install" | "assembly_typecheck" | "assembly_load_failure";

interface TriggerRow {
  readonly stage: FixStage;
  readonly owners: readonly FixOwner[];
  readonly formatOnly: boolean;
}

/* factory:BEH-012 trigger table: stage, owning roles and whether edits are format only. */
export const TRIGGER_TABLE: Readonly<Record<FixTrigger, TriggerRow>> = {
  spec_yaml_invalid: { stage: "spec", owners: ["spec-analyst"], formatOnly: true },
  design_file_invalid: { stage: "design", owners: ["architect", "verification-designer", "planner"], formatOnly: true },
  red_suite_error: { stage: "build", owners: ["test-writer"], formatOnly: false },
  green_typecheck: { stage: "build", owners: ["implementer"], formatOnly: false },
  green_load_failure: { stage: "build", owners: ["implementer"], formatOnly: false },
  assembly_install: { stage: "assembly", owners: ["assembler"], formatOnly: false },
  assembly_typecheck: { stage: "assembly", owners: ["assembler"], formatOnly: false },
  assembly_load_failure: { stage: "assembly", owners: ["assembler"], formatOnly: false },
};

export function isOwnerOf(trigger: FixTrigger, owner: FixOwner): boolean {
  return TRIGGER_TABLE[trigger].owners.includes(owner);
}
