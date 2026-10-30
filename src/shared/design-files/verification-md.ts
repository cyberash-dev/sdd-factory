import YAML from "yaml";
import { findSection, splitSections } from "./markdown-sections.js";

export type Feasibility = "feasible" | "infeasible_candidate";

export interface VerificationBlock {
  readonly id: string;
  readonly template: string;
  readonly feasibility: Feasibility;
  readonly yamlSource: string;
}

export interface VerificationDesign {
  readonly blocks: readonly VerificationBlock[];
  readonly infeasibleCandidates: readonly { readonly id: string; readonly reason: string }[];
}

export class VerificationMdParseError extends Error {
  override readonly name = "VerificationMdParseError";
}

const BLOCK_HEADING = /^###\s+(\S+)\s*$/;
const SPEC_ID = /[a-z][a-z0-9-]*:[A-Z]+-[0-9]{3}/;
const FILE_PATH_REFERENCE = /\b(?:src|tests)\/[\w./-]+|\b[\w-]+\.tsx?\b/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RawBlock {
  readonly heading: string;
  readonly yamlSource: string | null;
}

function collectRawBlocks(markdown: string): readonly RawBlock[] {
  const blocks: { heading: string; yamlSource: string | null }[] = [];
  let fence: string[] | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (fence !== null) {
      if (trimmed.startsWith("```")) {
        const current = blocks[blocks.length - 1];
        if (current !== undefined && current.yamlSource === null) {
          current.yamlSource = fence.join("\n");
        }
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      fence = [];
      continue;
    }
    const heading = BLOCK_HEADING.exec(line);
    if (heading !== null && heading[1] !== undefined) {
      blocks.push({ heading: heading[1], yamlSource: null });
    }
  }
  return blocks;
}

function parseBlock(raw: RawBlock): VerificationBlock {
  if (raw.yamlSource === null) {
    throw new VerificationMdParseError(`block ${raw.heading} has no yaml fence`);
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw.yamlSource);
  } catch (error) {
    throw new VerificationMdParseError(`block ${raw.heading}: yaml invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new VerificationMdParseError(`block ${raw.heading}: yaml is not a mapping`);
  }
  const template = parsed["template"];
  if (typeof template !== "string" || template.length === 0) {
    throw new VerificationMdParseError(`block ${raw.heading}: template missing`);
  }
  const id = typeof parsed["id"] === "string" ? parsed["id"] : raw.heading;
  return {
    id,
    template,
    feasibility: parsed["feasibility"] === "infeasible_candidate" ? "infeasible_candidate" : "feasible",
    yamlSource: raw.yamlSource,
  };
}

function parseInfeasibleCandidates(markdown: string): readonly { readonly id: string; readonly reason: string }[] {
  const section = findSection(splitSections(markdown), (title) => title.includes("infeasible"));
  if (section === null) {
    return [];
  }
  const candidates: { id: string; reason: string }[] = [];
  for (const line of section.lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) {
      continue;
    }
    const id = SPEC_ID.exec(trimmed)?.[0];
    if (id === undefined) {
      continue;
    }
    const reason = trimmed
      .slice(1)
      .replace(id, "")
      .replace(/^[\s:,—-]+/, "")
      .trim();
    candidates.push({ id, reason });
  }
  return candidates;
}

export function parseVerificationMd(markdown: string): VerificationDesign {
  const blocks = collectRawBlocks(markdown).map(parseBlock);
  if (blocks.length === 0) {
    throw new VerificationMdParseError("no verification blocks (### <id> headings) found");
  }
  const listed = parseInfeasibleCandidates(markdown);
  const listedIds = new Set(listed.map((candidate) => candidate.id));
  const flagged = blocks
    .filter((block) => block.feasibility === "infeasible_candidate" && !listedIds.has(block.id))
    .map((block) => ({ id: block.id, reason: "marked infeasible_candidate in its block" }));
  return { blocks, infeasibleCandidates: [...listed, ...flagged] };
}

export function missingVerificationBlocks(design: VerificationDesign, requiredIds: readonly string[]): readonly string[] {
  const present = new Set(design.blocks.map((block) => block.id));
  return requiredIds.filter((id) => !present.has(id));
}

export function filePathReferences(block: VerificationBlock): readonly string[] {
  return [...new Set(block.yamlSource.match(FILE_PATH_REFERENCE) ?? [])];
}

/* factory:BEH-012 format-only input: block id -> canonical JSON of each block that parses on its own; never throws. */
export function verificationBlockData(markdown: string): ReadonlyMap<string, string> {
  const data = new Map<string, string>();
  for (const raw of collectRawBlocks(markdown)) {
    try {
      const block = parseBlock(raw);
      data.set(block.id, JSON.stringify(YAML.parse(block.yamlSource)));
    } catch (error) {
      if (!(error instanceof VerificationMdParseError)) {
        throw error;
      }
    }
  }
  return data;
}
