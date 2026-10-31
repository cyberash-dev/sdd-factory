import { usageError, type CliError } from "../errors/index.js";

export type ParsedCommand =
  | { readonly kind: "add"; readonly text: string }
  | { readonly kind: "list"; readonly all: boolean }
  | { readonly kind: "done"; readonly id: number }
  | { readonly kind: "rm"; readonly id: number }
  | { readonly kind: "help" };

const ID_PATTERN = /^[1-9][0-9]*$/;

export function parseArgs(argv: readonly string[]): ParsedCommand | CliError {
  const [command, ...rest] = argv;
  switch (command) {
    case "add": {
      if (rest.length !== 1) return usageError("todo add <text>");
      const [text] = rest;
      if (text === undefined || text.trim() === "") return usageError("todo add <text>");
      return { kind: "add", text };
    }
    case "list": {
      if (rest.length === 0) return { kind: "list", all: false };
      if (rest.length === 1 && rest[0] === "--all") return { kind: "list", all: true };
      return usageError("todo list [--all]");
    }
    case "done":
    case "rm": {
      const [id] = rest;
      if (rest.length !== 1 || id === undefined || !ID_PATTERN.test(id)) {
        return usageError(`todo ${command} <id>`);
      }
      return { kind: command, id: Number(id) };
    }
    case "--help":
      if (rest.length === 0) return { kind: "help" };
      return usageError("todo --help");
    default:
      return usageError("todo <add|list|done|rm|--help>");
  }
}
