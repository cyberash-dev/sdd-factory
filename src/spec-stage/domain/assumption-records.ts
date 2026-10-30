import type { GaFinding } from "./ga-review.js";
import { isRecord } from "./guards.js";
import type { SpecRecord } from "./spec-records.js";

const SECTION_TITLES = [
  "Context",
  "Glossary",
  "Partition",
  "Brownfield baseline",
  "Surfaces",
  "Requirements",
  "Data contracts",
  "Invariants",
  "External dependencies",
  "Generated artifacts",
  "Localization",
  "Policies",
  "Constraints",
  "Migrations",
  "Deltas",
  "Implementation bindings",
  "Open questions",
  "Assumptions",
  "Out of scope",
] as const;

const ASSUMPTIONS_HEADING = "## 18. Assumptions";

export interface RenderedAssumption {
  readonly id: string;
  readonly block: string;
}

export interface CriticAssumptionInput {
  readonly slug: string;
  readonly number: number;
  readonly finding: GaFinding;
  readonly round: number;
  readonly reviewBy: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assumptionsSkeleton(slug: string): string {
  const sections = SECTION_TITLES.map((title, index) => `## ${index + 1}. ${title}\n\nnone\n`);
  return `# ${slug} assumptions (sandbox)\n\n> ASSUMPTION records minted after approval live here; see spec/spec.md for the approved records.\n\n---\n\n${sections.join("\n---\n\n")}`;
}

export function nextAssumptionNumber(slug: string, texts: readonly string[]): number {
  const pattern = new RegExp(`${escapeRegExp(slug)}:ASM-([0-9]{3})`, "g");
  let highest = 0;
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest + 1;
}

/* spec-stage:DLT-001: an open finding of the final critic round, recorded by the foreman as the reading taken. */
export function renderCriticAssumption(input: CriticAssumptionInput): RenderedAssumption {
  const id = `${input.slug}:ASM-${String(input.number).padStart(3, "0")}`;
  const assumption = input.finding.requiredChange
    .trim()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const notes = JSON.stringify(`critic finding ${input.finding.id} (${input.finding.kind}; targets ${input.finding.targetIds.join(", ")}) of round ${input.round}, unapplied at the critic cap; recorded by the foreman as the reading taken`);
  const block = [
    "```yaml",
    "---",
    `id: ${id}`,
    "type: ASSUMPTION",
    "lifecycle:",
    "  status: proposed",
    `partition_id: ${input.slug}`,
    "assumption: |",
    assumption,
    "source_open_q: not_applicable",
    "blocking: no",
    `review_by: "${input.reviewBy}"`,
    "default_if_unresolved: keep_assumption",
    "tests: []",
    `notes: ${notes}`,
    "---",
    "```",
  ].join("\n");
  return { id, block };
}

export interface DefaultAssumptionInput {
  readonly slug: string;
  readonly number: number;
  readonly openQuestion: SpecRecord;
  readonly reviewBy: string;
}

function defaultOptionText(openQuestion: SpecRecord): string {
  const chosen = String(openQuestion.fields["default_if_unresolved"]);
  const options = openQuestion.fields["options"];
  const option = Array.isArray(options) ? options.find((candidate) => isRecord(candidate) && candidate["id"] === chosen) : undefined;
  if (!isRecord(option)) {
    return `resolved by its default option \`${chosen}\``;
  }
  const label = typeof option["label"] === "string" ? option["label"] : chosen;
  const consequence = typeof option["consequence"] === "string" ? ` ${option["consequence"]}` : "";
  return `resolved by its default option \`${chosen}\`: ${label}.${consequence}`;
}

/* spec-stage:DLT-003: an undecided Open-Q with a default, decided by the foreman at approval. */
export function renderDefaultAssumption(input: DefaultAssumptionInput): RenderedAssumption {
  const id = `${input.slug}:ASM-${String(input.number).padStart(3, "0")}`;
  const title = typeof input.openQuestion.fields["title"] === "string" ? input.openQuestion.fields["title"] : input.openQuestion.id;
  const assumption = `${title}: ${defaultOptionText(input.openQuestion)}`
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const notes = JSON.stringify(`default_if_unresolved of ${input.openQuestion.id} materialised by the foreman at approval (spec-stage:INV-001)`);
  const block = [
    "```yaml",
    "---",
    `id: ${id}`,
    "type: ASSUMPTION",
    "lifecycle:",
    "  status: proposed",
    `partition_id: ${input.slug}`,
    "assumption: |",
    assumption,
    `source_open_q: ${input.openQuestion.id}`,
    "blocking: no",
    `review_by: "${input.reviewBy}"`,
    "default_if_unresolved: keep_assumption",
    "tests: []",
    `notes: ${notes}`,
    "---",
    "```",
  ].join("\n");
  return { id, block };
}

export function appendAssumptions(existing: string | null, slug: string, blocks: readonly string[]): string {
  const lines = (existing ?? assumptionsSkeleton(slug)).split("\n");
  const start = lines.findIndex((line) => line.trim() === ASSUMPTIONS_HEADING);
  if (start === -1) {
    throw new Error(`${ASSUMPTIONS_HEADING} heading missing from spec/assumptions.md`);
  }
  const nextHeading = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const end = nextHeading === -1 ? lines.length : nextHeading;
  const inserted = blocks.join("\n\n");
  const noneIndex = lines.slice(start + 1, end).findIndex((line) => line.trim() === "none");
  if (noneIndex !== -1) {
    lines.splice(start + 1 + noneIndex, 1, inserted);
    return lines.join("\n");
  }
  let insertAt = end;
  while (insertAt > start + 1 && ((lines[insertAt - 1] ?? "").trim() === "" || (lines[insertAt - 1] ?? "").trim() === "---")) {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, "", inserted);
  return lines.join("\n");
}
