import { parseSpecRecords, YAML_FENCE, type SpecRecord } from "./spec-records.js";

export interface SurfaceRepair {
  readonly surfaceId: string;
  readonly added: readonly string[];
  readonly detached: readonly string[];
  readonly text: string;
}

const MEMBERS_FIELD = /^members:[^\n]*(?:\n[ \t]+-[^\n]*)*/m;
const SURFACE_REF_LINE = /^surface_ref:[^\n]*\n/m;
const BOUNDARY_FIELDS = ["policy_refs", "applicability", "concurrency_model", "data_scope"] as const;

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

function withRecordBody(specText: string, id: string, rewrite: (body: string) => string): string | null {
  const fence = fenceOfRecord(specText, id);
  const body = fence?.[1];
  if (fence === null || body === undefined) {
    return null;
  }
  const start = fence.index + fence[0].indexOf(body);
  return `${specText.slice(0, start)}${rewrite(body)}${specText.slice(start + body.length)}`;
}

function carriesBoundaryFields(record: SpecRecord): boolean {
  return BOUNDARY_FIELDS.every((field) => record.fields[field] !== undefined && record.fields[field] !== null);
}

function withoutSurfaceRefs(specText: string, ids: readonly string[]): string | null {
  let text: string | null = specText;
  for (const id of ids) {
    text = text === null ? null : withRecordBody(text, id, (body) => body.replace(SURFACE_REF_LINE, ""));
  }
  return text;
}

function withMembers(specText: string, surfaceId: string, memberIds: readonly string[]): string | null {
  const rendered = ["members:", ...memberIds.map((memberId) => `  - ${memberId}`)].join("\n");
  return withRecordBody(specText, surfaceId, (body) => (MEMBERS_FIELD.test(body) ? body.replace(MEMBERS_FIELD, rendered) : `${body}\n${rendered}`));
}

/* spec-stage:DLT-004, DLT-007, DLT-008: the single Surface lists every Contract and every boundary record whose surface_ref names it, as `sdd ready` requires; a missing id is appended in record order, nothing else moves. A surface_ref record lacking a boundary field `sdd lint` requires of members loses its surface_ref instead. */
export function repairSurfaceMembers(specText: string): SurfaceRepair | null {
  const records = parseSpecRecords(specText);
  const surfaces = records.filter((record) => record.type === "Surface");
  const surface = surfaces[0];
  if (surfaces.length !== 1 || surface === undefined) {
    return null;
  }
  const members = surface.fields["members"];
  const memberIds = isStringArray(members) ? members : [];
  const outsideMembers = records.filter((record) => !memberIds.includes(record.id));
  const namesSurface = (record: SpecRecord): boolean => record.type !== "Contract" && record.fields["surface_ref"] === surface.id;
  const added = [...new Set(outsideMembers.filter((record) => record.type === "Contract" || (namesSurface(record) && carriesBoundaryFields(record))).map((record) => record.id))];
  const detached = [...new Set(outsideMembers.filter((record) => namesSurface(record) && !carriesBoundaryFields(record)).map((record) => record.id))];
  const detachedText = withoutSurfaceRefs(specText, detached);
  const text = added.length === 0 || detachedText === null ? detachedText : withMembers(detachedText, surface.id, [...memberIds, ...added]);
  return text === null ? null : { surfaceId: surface.id, added, detached, text };
}
