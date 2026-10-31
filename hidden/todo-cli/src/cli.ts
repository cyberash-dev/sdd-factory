import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatErrorLine, isCliError, storageError } from "./errors/index.js";
import type { CliError, CommandResult } from "./errors/index.js";
import { parseArgs } from "./parse/index.js";
import type { ParsedCommand } from "./parse/index.js";
import { runHelp, runList } from "./read-commands/index.js";
import { resolveStoragePath } from "./store/index.js";
import { runAdd, runDone, runRm } from "./write-commands/index.js";

function dispatch(command: ParsedCommand, path: string): CommandResult {
  switch (command.kind) {
    case "add":
      return runAdd(path, command.text, new Date());
    case "list":
      return runList(path, command.all);
    case "done":
      return runDone(path, command.id);
    case "rm":
      return runRm(path, command.id);
    case "help":
      return runHelp();
  }
}

export function run(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): CommandResult {
  const parsed = parseArgs(argv);
  if (isCliError(parsed)) return { ok: false, error: parsed };
  return dispatch(parsed, resolveStoragePath(env, cwd));
}

export function main(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): number {
  let result: CommandResult;
  try {
    result = run(argv, env, cwd);
  } catch {
    let path = cwd;
    try {
      path = resolveStoragePath(env, cwd);
    } catch {
      path = cwd;
    }
    const error: CliError = storageError(path);
    result = { ok: false, error };
  }
  if (result.ok) {
    process.stdout.write(result.stdout);
    return 0;
  }
  process.stderr.write(`${formatErrorLine(result.error)}\n`);
  return result.error.exitCode;
}

function isProcessEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isProcessEntry()) {
  process.exitCode = main(process.argv.slice(2), process.env, process.cwd());
}
