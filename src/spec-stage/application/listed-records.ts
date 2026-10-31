import { join } from "node:path";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { CommandRunner } from "../ports/command-runner.js";
import { outputTail } from "./stage-deps.js";

export interface ListedRecord {
  readonly id: string;
  readonly status: string | null;
  readonly file: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function listedRecordOf(item: unknown): readonly ListedRecord[] {
  return isRecord(item) && typeof item["id"] === "string" ? [{ id: item["id"], status: stringOrNull(item["status"]), file: stringOrNull(item["file"]) }] : [];
}

/* The records of every spec file of the product, as `sdd record list --format=json` reports them. */
export async function listedRecords(commands: CommandRunner, dir: string): Promise<readonly ListedRecord[]> {
  const list = await commands.run(["record", "list", "--format=json"], dir);
  if (list.exitCode !== 0) {
    throw new Error(`sdd record list exited ${list.exitCode}: ${outputTail(list)}`);
  }
  const parsed: unknown = JSON.parse(list.stdout);
  const records = isRecord(parsed) && Array.isArray(parsed["records"]) ? parsed["records"] : null;
  if (records === null) {
    throw new Error("sdd record list output has no records array");
  }
  return records.flatMap(listedRecordOf);
}

/* The partition's sandbox_paths in the product's .sdd/config.json: records there may stay proposed. */
export async function sandboxPaths(productDir: string, partition: string): Promise<readonly string[]> {
  const configText = await readTextOrNull(join(productDir, ".sdd", "config.json"));
  const config: unknown = configText === null ? null : JSON.parse(configText);
  const partitions = isRecord(config) ? config["partitions"] : null;
  const partitionConfig = isRecord(partitions) ? partitions[partition] : null;
  const paths = isRecord(partitionConfig) ? partitionConfig["sandbox_paths"] : null;
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : [];
}
