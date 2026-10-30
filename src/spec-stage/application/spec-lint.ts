import { join } from "node:path";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { fixScopeOf, runSimpleFix, type FixCheck, type FormatOnlyFile } from "../../shared/fixer/index.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import { canonicalRecordsById, yamlInvalidDiagnostics } from "../domain/spec-records.js";
import type { CommandResult, CommandRunner } from "../ports/command-runner.js";
import type { StageDeps } from "./stage-deps.js";

const RECORD_FILES: readonly string[] = ["spec/spec.md", "spec/assumptions.md"];

const FORMAT_ONLY_FILES: readonly FormatOnlyFile[] = RECORD_FILES.map((path) => ({ path, parse: canonicalRecordsById }));

interface ProductSpecLint {
  readonly result: CommandResult;
  readonly yamlInvalid: readonly string[];
}

async function yamlInvalidOf(productDir: string): Promise<readonly string[]> {
  const diagnostics: string[] = [];
  for (const file of RECORD_FILES) {
    const text = await readTextOrNull(join(productDir, file));
    if (text !== null) {
      diagnostics.push(...yamlInvalidDiagnostics(text, file));
    }
  }
  return diagnostics;
}

async function lintWithDiagnostics(commands: CommandRunner, productDir: string): Promise<ProductSpecLint> {
  const result = await commands.run(["lint", "--format=json"], productDir);
  const yamlInvalid = await yamlInvalidOf(productDir);
  if (yamlInvalid.length === 0) {
    return { result, yamlInvalid };
  }
  const separator = result.stdout === "" || result.stdout.endsWith("\n") ? "" : "\n";
  return { result: { exitCode: result.exitCode === 0 ? 1 : result.exitCode, stdout: `${result.stdout}${separator}${yamlInvalid.join("\n")}\n`, stderr: result.stderr }, yamlInvalid };
}

/* spec-stage:DLT-005: sdd lint plus one yaml_invalid line per record fence the parser rejects; such a fence fails the lint. */
export async function lintProductSpec(commands: CommandRunner, productDir: string): Promise<CommandResult> {
  return (await lintWithDiagnostics(commands, productDir)).result;
}

export async function hasYamlInvalidRecords(productDir: string): Promise<boolean> {
  return (await yamlInvalidOf(productDir)).length > 0;
}

function lintOutput(result: CommandResult): string {
  return `${result.stdout}${result.stderr}`;
}

/* spec-stage:DLT-006: a foreman lint with a yaml_invalid diagnostic goes to the simple-fixer (factory:BEH-012) before the caller's route. */
export async function lintProductSpecWithFix(slice: SliceContext, deps: StageDeps, context: EffectContext): Promise<CommandResult> {
  const productDir = slice.paths.productDir;
  const first = await lintWithDiagnostics(deps.commands, productDir);
  if (first.yamlInvalid.length === 0 || deps.fixer === undefined) {
    return first.result;
  }
  /* A discarded run restores the tree the previous check linted, so the latest check always describes the files on disk. */
  let latest = first.result;
  const check = async (): Promise<FixCheck> => {
    const lint = await lintWithDiagnostics(deps.commands, productDir);
    latest = lint.result;
    return { passed: lint.yamlInvalid.length === 0, output: lintOutput(lint.result) };
  };
  await runSimpleFix(slice, deps.fixer, context, {
    trigger: "spec_yaml_invalid",
    owner: "spec-analyst",
    unit: "spec",
    taskId: null,
    directory: productDir,
    scope: fixScopeOf({ trigger: "spec_yaml_invalid" }),
    formatOnly: FORMAT_ONLY_FILES,
    failureOutput: lintOutput(first.result),
    check,
  });
  return latest;
}
