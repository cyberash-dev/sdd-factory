import { INTERVENTION_KINDS } from "../../bus/domain/catalogue.js";

export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const LAUNCH_NOTE = "pre-authorized at launch: spec and baseline approvals delegated to the factory";
export const MID_RUN_COUNT_PREFIX = "mid-run interventions: ";

export function isInterventionKind(value: unknown): value is InterventionKind {
  return typeof value === "string" && (INTERVENTION_KINDS as readonly string[]).includes(value);
}

export function interventionLine(occurredAt: string, kind: InterventionKind, actor: string, note: string): string {
  const escapedNote = note.replace(/"/g, '\\"').replace(/\r?\n/g, " ");
  return `${occurredAt} ${kind} actor=${actor} note="${escapedNote}"\n`;
}

export function midRunCountLine(count: number): string {
  return `${MID_RUN_COUNT_PREFIX}${count}\n`;
}
