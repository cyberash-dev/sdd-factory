import YAML from "yaml";
import { isRecord, isStringArray } from "./guards.js";

export interface SpecRecord {
  readonly id: string;
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

const YAML_FENCE = /^```ya?ml\s*\n([\s\S]*?)\n```/gm;

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
    records.push({ id: parsed["id"], type: parsed["type"], fields: parsed });
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
  const openQuestionIds = idsOf(records, "Open-Q");
  const referencedBy = new Map<string, number>();
  for (const assumption of records.filter((record) => record.type === "ASSUMPTION")) {
    const source = assumption.fields["source_open_q"];
    if (typeof source === "string") {
      referencedBy.set(source, (referencedBy.get(source) ?? 0) + 1);
    }
  }
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
  for (const source of referencedBy.keys()) {
    if (!openQuestionIds.includes(source)) {
      problems.push(`ASSUMPTION source_open_q ${source} names no Open-Q`);
    }
  }
  return problems;
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

export function specIntegrityProblems(specText: string): readonly string[] {
  const records = parseSpecRecords(specText);
  return [...surfaceProblems(records), ...undecidedOpenQuestions(records)];
}
