import { parseSpecRecords, YAML_FENCE } from "./spec-records.js";

export interface SurfaceRepair {
  readonly surfaceId: string;
  readonly added: readonly string[];
  readonly text: string;
}

const MEMBERS_FIELD = /^members:[^\n]*(?:\n[ \t]+-[^\n]*)*/m;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function fenceOfRecord(specText: string, id: string): RegExpExecArray | null {
  for (const match of specText.matchAll(YAML_FENCE)) {
    if (new RegExp(`^id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(match[1] ?? "")) {
      return match;
    }
  }
  return null;
}

/* spec-stage:DLT-004, DLT-007: the single Surface lists every Contract and every record whose surface_ref names it, as `sdd ready` requires; a missing id is appended in record order, nothing else moves. */
export function repairSurfaceMembers(specText: string): SurfaceRepair | null {
  const records = parseSpecRecords(specText);
  const surfaces = records.filter((record) => record.type === "Surface");
  const surface = surfaces[0];
  if (surfaces.length !== 1 || surface === undefined) {
    return null;
  }
  const members = surface.fields["members"];
  const memberIds = isStringArray(members) ? members : [];
  const belongsToSurface = records.filter((record) => record.type === "Contract" || record.fields["surface_ref"] === surface.id).map((record) => record.id);
  const added = [...new Set(belongsToSurface)].filter((id) => !memberIds.includes(id));
  if (added.length === 0) {
    return { surfaceId: surface.id, added, text: specText };
  }
  const fence = fenceOfRecord(specText, surface.id);
  const body = fence?.[1];
  if (fence === null || body === undefined) {
    return null;
  }
  const rendered = ["members:", ...[...memberIds, ...added].map((memberId) => `  - ${memberId}`)].join("\n");
  const repairedBody = MEMBERS_FIELD.test(body) ? body.replace(MEMBERS_FIELD, rendered) : `${body}\n${rendered}`;
  const start = fence.index + fence[0].indexOf(body);
  return { surfaceId: surface.id, added, text: `${specText.slice(0, start)}${repairedBody}${specText.slice(start + body.length)}` };
}
