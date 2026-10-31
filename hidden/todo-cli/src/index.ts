import { isCliError, exitCodeFor, makeError } from "./errors/index.js";
import { readTaskList, resolveStorePath, writeTaskList } from "./store/index.js";
import type { TaskList } from "./store/index.js";
import { parseArgs } from "./args/index.js";
import type { ParsedCommand } from "./args/index.js";
import { runAdd, runDone, runList, runRm } from "./commands/index.js";
import type { CommandOutcome } from "./commands/index.js";

export interface Streams {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export function usageText(): string {
  return [
    "usage:",
    "  todo add <text>",
    "  todo list [--all]",
    "  todo done <id>",
    "  todo rm <id>",
    "  todo --help",
  ].join("\n");
}

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  streams: Streams,
  clock: () => Date = () => new Date(),
): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (isCliError(parsed)) {
      streams.err(parsed.line);
      return exitCodeFor(parsed);
    }
    if (parsed.command === "help") {
      streams.out(usageText());
      return 0;
    }
    const path = resolveStorePath(env);
    const read = readTaskList(path);
    if (!read.ok) {
      const error = makeError("E_CANNOT_READ", path);
      streams.err(error.line);
      return exitCodeFor(error);
    }
    const outcome = execute(parsed, read.value, clock);
    if (!outcome.ok) {
      streams.err(outcome.error.line);
      return exitCodeFor(outcome.error);
    }
    if (outcome.list !== null && !writeTaskList(path, outcome.list).ok) {
      const error = makeError("E_CANNOT_READ", path);
      streams.err(error.line);
      return exitCodeFor(error);
    }
    for (const line of outcome.lines) {
      streams.out(line);
    }
    return 0;
  } catch {
    streams.err("error: unexpected failure");
    return 1;
  }
}

function execute(
  parsed: Exclude<ParsedCommand, { readonly command: "help" }>,
  list: TaskList,
  clock: () => Date,
): CommandOutcome {
  switch (parsed.command) {
    case "add":
      return runAdd(list, parsed.text, clock);
    case "list":
      return runList(list, parsed.all);
    case "done":
      return runDone(list, parsed.idToken);
    case "rm":
      return runRm(list, parsed.idToken);
  }
}
