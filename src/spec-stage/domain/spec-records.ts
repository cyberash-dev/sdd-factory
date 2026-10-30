import YAML from "yaml";
import { isRecord, isStringArray } from "./guards.js";

export interface SpecRecord {
  readonly id: string;
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

const YAML_FENCE = /^```ya?ml\s*\n([\s\S]*?)\n```/gm;

const CANONICAL_TYPES = [
  "Partition",
  "BrownfieldBaseline",
  "Surface",
  "Behavior",
  "Invariant",
  "Contract",
  "Scenario",
  "NFR",
  "Constraint",
  "Policy",
  "Migration",
  "Delta",
  "GeneratedArtifact",
  "ExternalDependency",
  "LocalizationContract",
  "ImplementationBinding",
  "Open-Q",
  "ASSUMPTION",
] as const;

const TYPE_ALIASES: Readonly<Record<string, string>> = { openquestion: "Open-Q", openq: "Open-Q" };

function typeKey(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* sdd lint accepts alternative spellings of the template names; records are compared by their canonical type. */
export function canonicalRecordType(type: string): string {
  const key = typeKey(type);
  return TYPE_ALIASES[key] ?? CANONICAL_TYPES.find((candidate) => typeKey(candidate) === key) ?? type;
}

function stripDocumentMarkers(body: string): string {
  return body
    .split("\n")
    .filter((line) => line.trim() !== "---")
    .join("\n");
}

export function parseSpecRecords(specText: string): readonly SpecRecord[] {
  const records: SpecRecord[] = [];
  for (const match of specText.matchAll(YAML_FENCE)) {
    let parsed: unknown;
    try {
      parsed = YAML.parse(stripDocumentMarkers(match[1] ?? ""));
    } catch {
      continue;
    }
    if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["type"] !== "string") {
      continue;
    }
    records.push({ id: parsed["id"], type: canonicalRecordType(parsed["type"]), fields: parsed });
  }
  return records;
}

function idsOf(records: readonly SpecRecord[], type: string): readonly string[] {
  return records.filter((record) => record.type === type).map((record) => record.id);
}

function assumptionReferences(records: readonly SpecRecord[]): ReadonlyMap<string, number> {
  const referencedBy = new Map<string, number>();
  for (const assumption of records.filter((record) => record.type === "ASSUMPTION")) {
    const source = assumption.fields["source_open_q"];
    if (typeof source === "string") {
      referencedBy.set(source, (referencedBy.get(source) ?? 0) + 1);
    }
  }
  return referencedBy;
}

function isBlocking(record: SpecRecord): boolean {
  const blocking = record.fields["blocking"];
  return blocking === true || blocking === "yes";
}

function hasDefault(record: SpecRecord): boolean {
  const value = record.fields["default_if_unresolved"];
  return value !== undefined && value !== null;
}

/* spec-stage:DLT-003: Open-Q records the foreman can decide by their own default before approval. */
export function openQuestionsDecidableByDefault(records: readonly SpecRecord[]): readonly SpecRecord[] {
  const referencedBy = assumptionReferences(records);
  return records.filter((record) => record.type === "Open-Q" && !isBlocking(record) && hasDefault(record) && (referencedBy.get(record.id) ?? 0) === 0);
}

function undecidedOpenQuestions(records: readonly SpecRecord[]): readonly string[] {
  const referencedBy = assumptionReferences(records);
  const problems: string[] = [];
  for (const record of records.filter((candidate) => candidate.type === "Open-Q")) {
    const blocking = record.fields["blocking"];
    if (blocking === true || blocking === "yes") {
      problems.push(`${record.id} is blocking`);
    }
    if (record.fields["default_if_unresolved"] === undefined || record.fields["default_if_unresolved"] === null) {
      problems.push(`${record.id} has no default_if_unresolved`);
    }
    const references = referencedBy.get(record.id) ?? 0;
    if (references !== 1) {
      problems.push(`${record.id} is referenced by ${references} ASSUMPTION records, expected 1`);
    }
  }
  return problems;
}

function danglingAssumptionSources(records: readonly SpecRecord[]): readonly string[] {
  const openQuestionIds = idsOf(records, "Open-Q");
  return [...assumptionReferences(records).keys()].filter((source) => !openQuestionIds.includes(source)).map((source) => `ASSUMPTION source_open_q ${source} names no Open-Q`);
}

/* spec-stage:DLT-003: an assumption whose question vanished is inconsistent but harmless; it is reported, not blocking. */
export function specIntegrityWarnings(specText: string): readonly string[] {
  return danglingAssumptionSources(parseSpecRecords(specText));
}

function surfaceProblems(records: readonly SpecRecord[]): readonly string[] {
  const surfaces = records.filter((record) => record.type === "Surface");
  if (surfaces.length !== 1) {
    return [`expected exactly one Surface, found ${surfaces.length}`];
  }
  const members = surfaces[0]?.fields["members"];
  const memberIds = isStringArray(members) ? members : [];
  return idsOf(records, "Contract")
    .filter((contractId) => !memberIds.includes(contractId))
    .map((contractId) => `${contractId} is not a member of ${surfaces[0]?.id ?? "the Surface"}`);
}

export interface SurfaceRepair {
  readonly surfaceId: string;
  readonly added: readonly string[];
  readonly text: string;
}

const MEMBERS_FIELD = /^members:[^\n]*(?:\n[ \t]+-[^\n]*)*/m;

function fenceOfRecord(specText: string, id: string): RegExpExecArray | null {
  for (const match of specText.matchAll(YAML_FENCE)) {
    if (new RegExp(`^id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(match[1] ?? "")) {
      return match;
    }
  }
  return null;
}

/* spec-stage:DLT-004: the single Surface lists every Contract; a missing id is appended in record order, nothing else moves. */
export function repairSurfaceMembers(specText: string): SurfaceRepair | null {
  const records = parseSpecRecords(specText);
  const surfaces = records.filter((record) => record.type === "Surface");
  const surface = surfaces[0];
  if (surfaces.length !== 1 || surface === undefined) {
    return null;
  }
  const members = surface.fields["members"];
  const memberIds = isStringArray(members) ? members : [];
  const added = idsOf(records, "Contract").filter((contractId) => !memberIds.includes(contractId));
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

export function specIntegrityProblems(specText: string): readonly string[] {
  const records = parseSpecRecords(specText);
  return [...surfaceProblems(records), ...undecidedOpenQuestions(records)];
}
