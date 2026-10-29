import { join } from "node:path";
import { writeTextAtomic } from "../../shared/fs/text.js";
import { redactSecrets } from "../domain/redaction.js";
import type { CommandResult } from "../ports/outbound/command-runner.js";

export function evidenceDirFor(handoffsDir: string, round: number): string {
  return join(handoffsDir, "assembly", `round-${round}`);
}

export function commandLog(result: CommandResult, secrets: readonly string[]): string {
  return redactSecrets(`--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`, secrets);
}

export async function captureCommand(evidenceDir: string, name: string, result: CommandResult, secrets: readonly string[]): Promise<string> {
  const path = join(evidenceDir, `${name}.log`);
  await writeTextAtomic(path, commandLog(result, secrets));
  return path;
}

export function tailOf(text: string, lines: number): string {
  return text.split("\n").slice(-lines).join("\n");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
