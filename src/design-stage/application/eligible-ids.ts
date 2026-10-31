import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import type { CommandRunner } from "../ports/outbound/command-runner.js";

/* design-stage:DLT-008: the templates `sdd ready` (agent-sdd 2.1.1) requires a @covers marker for, i.e. every normative template except Surface. */
export const TASK_COVER_TYPES: readonly string[] = ["Behavior", "Invariant", "Contract", "Scenario", "NFR", "Constraint", "Policy", "Migration", "Delta", "GeneratedArtifact", "ExternalDependency", "LocalizationContract"];
export const VERIFICATION_BLOCK_TYPES: readonly string[] = ["Behavior", "Contract", "Invariant", "Scenario", "NFR", "Policy"];

const YAML_FENCE = /^```yaml[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm;

interface ListedRecord {
  readonly id: string;
  readonly type: string;
  readonly file: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listedRecordOf(record: Record<string, unknown>): ListedRecord | null {
  const { id, type, file } = record;
  return typeof id === "string" && typeof type === "string" ? { id, type, file: typeof file === "string" ? file : null } : null;
}

/* Approved records of the product spec, by record type, read through `sdd record list --format=json`. */
async function approvedRecords(commands: CommandRunner, productDir: string, timeoutMs: number, types: readonly string[]): Promise<readonly ListedRecord[]> {
  const result = await commands.run({ file: "npx", args: ["sdd", "record", "list", "--format=json"], cwd: productDir, timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(`sdd record list exited ${result.exitCode}: ${result.stderr.slice(-500)}`);
  }
  const parsed: unknown = JSON.parse(result.stdout);
  const records = isRecord(parsed) && Array.isArray(parsed["records"]) ? parsed["records"] : null;
  if (records === null) {
    throw new Error("sdd record list output has no records array");
  }
  return records
    .filter(isRecord)
    .filter((record) => record["status"] === "approved")
    .map(listedRecordOf)
    .filter((record): record is ListedRecord => record !== null && types.includes(record.type));
}

export async function approvedRecordIds(commands: CommandRunner, productDir: string, timeoutMs: number, types: readonly string[]): Promise<readonly string[]> {
  return (await approvedRecords(commands, productDir, timeoutMs, types)).map((record) => record.id);
}

/* The same test as agent-sdd's isNotApplicableTestObligation. */
function isNotApplicableObligation(obligation: unknown): boolean {
  return (typeof obligation === "string" && obligation.startsWith("not_applicable")) || (isRecord(obligation) && obligation["not_applicable"] !== undefined);
}

function fenceRecords(body: string): readonly Record<string, unknown>[] {
  return parseAllDocuments(body).flatMap((document) => {
    if (document.errors.length > 0) {
      return [];
    }
    const value: unknown = document.toJS();
    const items: readonly unknown[] = Array.isArray(value) ? value : [value];
    return items.filter(isRecord);
  });
}

function notApplicableIdsIn(markdown: string): readonly string[] {
  return [...markdown.matchAll(YAML_FENCE)]
    .flatMap((match) => fenceRecords(match[1] ?? ""))
    .filter((record) => isNotApplicableObligation(record["test_obligation"]))
    .map((record) => record["id"])
    .filter((id): id is string => typeof id === "string");
}

/* design-stage:DLT-008: the approved records `sdd ready` requires a @covers marker for; the files are the ones sdd read the records from. */
export async function taskCoverIds(commands: CommandRunner, productDir: string, timeoutMs: number): Promise<readonly string[]> {
  const records = await approvedRecords(commands, productDir, timeoutMs, TASK_COVER_TYPES);
  const files = [...new Set(records.map((record) => record.file).filter((file): file is string => file !== null))];
  const notApplicable = new Set<string>();
  for (const file of files) {
    for (const id of notApplicableIdsIn(await readFile(join(productDir, file), "utf8"))) {
      notApplicable.add(id);
    }
  }
  return records.filter((record) => !notApplicable.has(record.id)).map((record) => record.id);
}
