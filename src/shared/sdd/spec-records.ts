import YAML from "yaml";

export interface SpecRecord {
  readonly id: string;
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export const YAML_FENCE = /^```ya?ml\s*\n([\s\S]*?)\n```/gm;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeKey(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* sdd lint accepts alternative spellings of the template names; records are compared by their canonical type. */
function canonicalRecordType(type: string): string {
  const key = typeKey(type);
  return TYPE_ALIASES[key] ?? CANONICAL_TYPES.find((candidate) => typeKey(candidate) === key) ?? type;
}

export function stripDocumentMarkers(body: string): string {
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
