import YAML from "yaml";
import { findSection, splitSections, type MarkdownSection } from "./markdown-sections.js";

export interface TechExport {
  readonly name: string;
  readonly kind: "function" | "class" | "const" | "type" | "interface";
  readonly signature: string;
}

export interface TechModule {
  readonly id: string;
  readonly name: string;
  readonly responsibility: string;
  readonly covers: readonly string[];
  readonly owns: readonly string[];
  readonly entry: string;
  readonly dependsOn: readonly string[];
  readonly interfaceSource: string;
  readonly exports: readonly TechExport[];
  readonly notes: string;
}

export interface TechTooling {
  readonly node: string;
  readonly testCmd: string;
  readonly typecheckCmd: string;
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
  readonly tsconfig: Readonly<Record<string, unknown>> | null;
}

export interface TraceabilityRow {
  readonly specId: string;
  readonly moduleId: string;
}

export interface TechDesign {
  readonly modules: readonly TechModule[];
  readonly tooling: TechTooling;
  readonly traceability: readonly TraceabilityRow[];
}

export class TechMdParseError extends Error {
  override readonly name = "TechMdParseError";
}

export class UnpinnedDependencyError extends TechMdParseError {
  constructor(readonly dependency: string) {
    super(`unpinned dependency: ${dependency}`);
  }
}

const MODULE_HEADING = /^###\s+(M-\d{2})\s+(.+?)\s*$/;
const FIELD_LINE = /^\s*-\s+([a-z_ ]+?):\s*(.*)$/;
const EXPORT_LINE = /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|const|type|interface)\s+([A-Za-z_$][\w$]*)/;
const PINNED_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MODULE_ID = /^M-\d{2}$/;
const TRAILING_COMMENT = /\s+\(.*\)\s*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("`") && trimmed.endsWith("`"));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function parseList(raw: string): readonly string[] {
  const value = raw.replace(TRAILING_COMMENT, "").trim();
  const inner = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return inner
    .split(",")
    .map(stripQuotes)
    .filter((item) => item.length > 0);
}

function parsePath(raw: string): string {
  return stripQuotes(raw.replace(TRAILING_COMMENT, ""));
}

interface ModuleBlock {
  readonly id: string;
  readonly name: string;
  readonly lines: readonly string[];
}

function splitModuleBlocks(lines: readonly string[]): readonly ModuleBlock[] {
  const blocks: ModuleBlock[] = [];
  let current: { id: string; name: string; lines: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
    }
    const heading = inFence ? null : MODULE_HEADING.exec(line);
    if (heading !== null && heading[1] !== undefined && heading[2] !== undefined) {
      current = { id: heading[1], name: heading[2], lines: [] };
      blocks.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return blocks;
}

function dedent(lines: readonly string[], indent: number): string {
  return lines.map((line) => (line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line.trimStart())).join("\n");
}

interface ModuleFields {
  readonly fields: ReadonlyMap<string, string>;
  readonly interfaceSource: string;
}

function collectModuleFields(lines: readonly string[]): ModuleFields {
  const fields = new Map<string, string>();
  let interfaceSource: string | null = null;
  let fenceLines: string[] | null = null;
  let fenceIndent = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (fenceLines !== null) {
      if (trimmed.startsWith("```")) {
        interfaceSource ??= dedent(fenceLines, fenceIndent);
        fenceLines = null;
      } else {
        fenceLines.push(line);
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      fenceLines = [];
      fenceIndent = line.length - line.trimStart().length;
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (field !== null && field[1] !== undefined && field[2] !== undefined) {
      fields.set(field[1].trim().replace(/\s+/g, "_"), field[2]);
    }
  }
  return { fields, interfaceSource: interfaceSource ?? "" };
}

function signatureAt(lines: readonly string[], start: number, kind: TechExport["kind"]): string {
  const first = lines[start]?.trim() ?? "";
  if (kind === "class" || kind === "interface") {
    return first;
  }
  const collected: string[] = [];
  for (let index = start; index < Math.min(lines.length, start + 20); index += 1) {
    collected.push(lines[index]?.trim() ?? "");
    if (collected.join(" ").trimEnd().endsWith(";")) {
      break;
    }
  }
  return collected.join(" ");
}

function isExportKind(value: string): value is TechExport["kind"] {
  return value === "function" || value === "class" || value === "const" || value === "type" || value === "interface";
}

export function parseInterfaceExports(source: string): readonly TechExport[] {
  const lines = source.split("\n");
  const exports: TechExport[] = [];
  lines.forEach((line, index) => {
    const match = EXPORT_LINE.exec(line);
    if (match === null || match[1] === undefined || match[2] === undefined || !isExportKind(match[1])) {
      return;
    }
    exports.push({ name: match[2], kind: match[1], signature: signatureAt(lines, index, match[1]) });
  });
  return exports;
}

function parseModule(block: ModuleBlock): TechModule {
  const { fields, interfaceSource } = collectModuleFields(block.lines);
  const owns = parseList(fields.get("owns") ?? "");
  if (owns.length === 0) {
    throw new TechMdParseError(`module ${block.id} has no owns path`);
  }
  const entry = parsePath(fields.get("entry") ?? "");
  if (entry.length === 0) {
    throw new TechMdParseError(`module ${block.id} has no entry path`);
  }
  return {
    id: block.id,
    name: block.name,
    responsibility: (fields.get("responsibility") ?? "").trim(),
    covers: parseList(fields.get("covers") ?? ""),
    owns,
    entry,
    dependsOn: parseList(fields.get("depends_on") ?? ""),
    interfaceSource,
    exports: parseInterfaceExports(interfaceSource),
    notes: (fields.get("notes") ?? "").trim(),
  };
}

function firstFence(lines: readonly string[]): string | null {
  const content: string[] = [];
  let open = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (open) {
        return content.join("\n");
      }
      open = true;
      continue;
    }
    if (open) {
      content.push(line);
    }
  }
  return null;
}

function dependencyString(entry: unknown, listName: string): string {
  if (typeof entry === "string") {
    return entry.trim();
  }
  if (isRecord(entry) && typeof entry["name"] === "string") {
    const version = entry["version"];
    return version === undefined || version === null ? entry["name"] : `${entry["name"]}@${String(version)}`;
  }
  throw new TechMdParseError(`TD-TOOLING ${listName} entry is neither a string nor {name, version}`);
}

function assertPinned(dependency: string): string {
  const separator = dependency.lastIndexOf("@");
  if (separator <= 0 || !PINNED_VERSION.test(dependency.slice(separator + 1))) {
    throw new UnpinnedDependencyError(dependency);
  }
  return dependency;
}

function dependencyList(tooling: Record<string, unknown>, key: string): readonly string[] {
  const value = tooling[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TechMdParseError(`TD-TOOLING ${key} must be a list`);
  }
  return value.map((entry) => assertPinned(dependencyString(entry, key)));
}

function toolingString(tooling: Record<string, unknown>, key: string): string {
  const value = tooling[key];
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TechMdParseError(`TD-TOOLING key missing: ${key}`);
  }
  return value.trim();
}

function parseTooling(section: MarkdownSection): TechTooling {
  const fence = firstFence(section.lines);
  if (fence === null) {
    throw new TechMdParseError("TD-TOOLING yaml block missing");
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(fence);
  } catch (error) {
    throw new TechMdParseError(`TD-TOOLING yaml invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tooling = isRecord(parsed) && isRecord(parsed["TD-TOOLING"]) ? parsed["TD-TOOLING"] : parsed;
  if (!isRecord(tooling)) {
    throw new TechMdParseError("TD-TOOLING yaml block is not a mapping");
  }
  const tsconfig = tooling["tsconfig"];
  return {
    node: toolingString(tooling, "node"),
    testCmd: toolingString(tooling, "test_cmd"),
    typecheckCmd: toolingString(tooling, "typecheck_cmd"),
    dependencies: dependencyList(tooling, "dependencies"),
    devDependencies: dependencyList(tooling, "dev_dependencies"),
    tsconfig: isRecord(tsconfig) ? tsconfig : null,
  };
}

function parseTraceability(section: MarkdownSection): readonly TraceabilityRow[] {
  const rows: TraceabilityRow[] = [];
  for (const line of section.lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => stripQuotes(cell));
    const [specId, moduleId] = cells;
    if (specId === undefined || moduleId === undefined || !MODULE_ID.test(moduleId)) {
      continue;
    }
    rows.push({ specId, moduleId });
  }
  if (rows.length === 0) {
    throw new TechMdParseError("traceability table has no rows");
  }
  return rows;
}

function requireSection(sections: readonly MarkdownSection[], matcher: (title: string) => boolean, label: string): MarkdownSection {
  const section = findSection(sections, matcher);
  if (section === null) {
    throw new TechMdParseError(`missing section: ${label}`);
  }
  return section;
}

export function parseTechMd(markdown: string): TechDesign {
  const sections = splitSections(markdown);
  const moduleSection = requireSection(sections, (title) => title === "module map" || title === "modules", "## Module map");
  const toolingSection = requireSection(sections, (title) => title.includes("tooling"), "## TD-TOOLING");
  const traceabilitySection = requireSection(sections, (title) => title.startsWith("traceability"), "## Traceability");
  const blocks = splitModuleBlocks(moduleSection.lines);
  if (blocks.length === 0) {
    throw new TechMdParseError("no module blocks under ## Module map");
  }
  return {
    modules: blocks.map(parseModule),
    tooling: parseTooling(toolingSection),
    traceability: parseTraceability(traceabilitySection),
  };
}

/* factory:BEH-012 format-only input; the parser is all-or-nothing, so a file that does not parse yields no blocks. Never throws. */
export function techMdBlockData(markdown: string): ReadonlyMap<string, string> {
  let design: TechDesign;
  try {
    design = parseTechMd(markdown);
  } catch (error) {
    if (error instanceof TechMdParseError) {
      return new Map();
    }
    throw error;
  }
  return new Map([...design.modules.map((module) => [module.id, JSON.stringify(module)] as const), ["TD-TOOLING", JSON.stringify(design.tooling)], ["traceability", JSON.stringify(design.traceability)]]);
}
