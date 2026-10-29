import type { CommandRunner } from "../ports/outbound/command-runner.js";

export const TASK_COVER_TYPES: readonly string[] = ["Behavior", "Contract", "Invariant", "Scenario", "NFR", "Constraint", "Policy"];
export const VERIFICATION_BLOCK_TYPES: readonly string[] = ["Behavior", "Contract", "Invariant", "Scenario", "NFR", "Policy"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* Approved ids of the product spec, by record type, read through `sdd record list --format=json`. */
export async function approvedRecordIds(commands: CommandRunner, productDir: string, timeoutMs: number, types: readonly string[]): Promise<readonly string[]> {
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
    .filter((record) => record["status"] === "approved" && typeof record["type"] === "string" && types.includes(record["type"]))
    .map((record) => record["id"])
    .filter((id): id is string => typeof id === "string");
}
