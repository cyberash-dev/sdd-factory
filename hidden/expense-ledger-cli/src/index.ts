import { resolveLedgerPath } from "./store/index.js";
import { parseArgv, USAGE_TEXT } from "./parse/index.js";
import { runList, runSummary, runExport } from "./query/index.js";
import { runAdd, runRm } from "./mutate/index.js";
import { exitCodeFor, renderDiagnostic, type CommandOutcome } from "./diagnostics/index.js";
import type { Command } from "./domain/index.js";

export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env: Record<string, string | undefined>;
  readonly now: () => Date;
}

function dispatch(command: Exclude<Command, { kind: "help" }>, ledgerPath: string, now: Date): CommandOutcome {
  switch (command.kind) {
    case "add":
      return runAdd(command, ledgerPath, now);
    case "list":
      return runList(command, ledgerPath);
    case "summary":
      return runSummary(command, ledgerPath);
    case "rm":
      return runRm(command, ledgerPath);
    case "export":
      return runExport(ledgerPath);
  }
}

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    io.stderr(renderDiagnostic(parsed.error));
    return exitCodeFor(parsed.error.code);
  }
  if (parsed.command.kind === "help") {
    for (const line of USAGE_TEXT) io.stdout(line);
    return exitCodeFor("E_SUCCESS");
  }
  const outcome = dispatch(parsed.command, resolveLedgerPath(io.env), io.now());
  if (!outcome.ok) {
    io.stderr(renderDiagnostic(outcome.error));
    return exitCodeFor(outcome.error.code);
  }
  for (const line of outcome.lines) io.stdout(line);
  return exitCodeFor("E_SUCCESS");
}
