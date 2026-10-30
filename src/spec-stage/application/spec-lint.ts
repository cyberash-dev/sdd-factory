import { join } from "node:path";
import { readTextOrNull } from "../../shared/fs/text.js";
import { yamlInvalidDiagnostics } from "../domain/spec-records.js";
import type { CommandResult, CommandRunner } from "../ports/command-runner.js";

const RECORD_FILES: readonly string[] = ["spec/spec.md", "spec/assumptions.md"];

/* spec-stage:DLT-005: sdd lint plus one yaml_invalid line per record fence the parser rejects; such a fence fails the lint. */
export async function lintProductSpec(commands: CommandRunner, productDir: string): Promise<CommandResult> {
  const result = await commands.run(["lint", "--format=json"], productDir);
  const diagnostics: string[] = [];
  for (const file of RECORD_FILES) {
    const text = await readTextOrNull(join(productDir, file));
    if (text !== null) {
      diagnostics.push(...yamlInvalidDiagnostics(text, file));
    }
  }
  if (diagnostics.length === 0) {
    return result;
  }
  const separator = result.stdout === "" || result.stdout.endsWith("\n") ? "" : "\n";
  return { exitCode: result.exitCode === 0 ? 1 : result.exitCode, stdout: `${result.stdout}${separator}${diagnostics.join("\n")}\n`, stderr: result.stderr };
}
