import YAML from "yaml";
import { parseSpecRecords, stripDocumentMarkers, YAML_FENCE, type SpecRecord } from "../../shared/sdd/spec-records.js";
import { isRecord, isStringArray } from "./guards.js";

export { parseSpecRecords, type SpecRecord } from "../../shared/sdd/spec-records.js";
export { repairSurfaceMembers } from "../../shared/sdd/surface-members.js";

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

/* spec-stage:DLT-005: sdd lint skips a fence its yaml parser rejects; the factory reports it so the author repairs it. */
export function yamlInvalidDiagnostics(specText: string, file: string): readonly string[] {
  const diagnostics: string[] = [];
  for (const match of specText.matchAll(YAML_FENCE)) {
    const body = match[1] ?? "";
    const document = YAML.parseDocument(stripDocumentMarkers(body));
    const firstError = document.errors[0];
    if (firstError === undefined) {
      continue;
    }
    const fenceLine = specText.slice(0, match.index).split("\n").length;
    const recordLine = fenceLine + 1 + (body.startsWith("---\n") ? 1 : 0);
    const id = /^id:\s*(\S+)/m.exec(body)?.[1];
    const subject = id === undefined ? `fence at line ${recordLine}` : id;
    const message = firstError.message.split("\n")[0] ?? firstError.message;
    diagnostics.push(`yaml_invalid ${subject} (${file}, record at line ${recordLine}): ${message}`);
  }
  return diagnostics;
}

export function specIntegrityProblems(specText: string): readonly string[] {
  const records = parseSpecRecords(specText);
  return [...surfaceProblems(records), ...undecidedOpenQuestions(records)];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/* factory:BEH-012 format-only check: id -> key-order-independent JSON of every fence that parses; unparseable fences are absent. */
export function canonicalRecordsById(specText: string): ReadonlyMap<string, string> {
  const records = new Map<string, string>();
  for (const match of specText.matchAll(YAML_FENCE)) {
    let parsed: unknown;
    try {
      parsed = YAML.parse(stripDocumentMarkers(match[1] ?? ""));
    } catch {
      continue;
    }
    if (isRecord(parsed) && typeof parsed["id"] === "string") {
      records.set(parsed["id"], canonicalJson(parsed));
    }
  }
  return records;
}
