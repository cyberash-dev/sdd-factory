import { makeError } from "../errors/index.js";
import type { CliError } from "../errors/index.js";

export type ParsedCommand =
  | { readonly command: "help" }
  | { readonly command: "add"; readonly text: string }
  | { readonly command: "list"; readonly all: boolean }
  | { readonly command: "done"; readonly idToken: string }
  | { readonly command: "rm"; readonly idToken: string };

const POSITIVE_INTEGER = /^0*[1-9][0-9]*$/;

function parseId(
  command: "done" | "rm",
  rest: readonly string[],
): ParsedCommand | CliError {
  const [token, ...extra] = rest;
  if (token === undefined) {
    return makeError("E_USAGE_MISSING_ARGUMENT");
  }
  if (token.startsWith("--")) {
    return makeError("E_USAGE_UNKNOWN_OPTION", token);
  }
  if (!POSITIVE_INTEGER.test(token)) {
    return makeError("E_USAGE_INVALID_ID", token);
  }
  const option = extra.find((extraToken) => extraToken.startsWith("--"));
  if (option !== undefined) {
    return makeError("E_USAGE_UNKNOWN_OPTION", option);
  }
  return { command, idToken: token };
}

export function parseArgs(argv: readonly string[]): ParsedCommand | CliError {
  const [name, ...rest] = argv;
  switch (name) {
    case undefined:
      return makeError("E_USAGE_MISSING_ARGUMENT");
    case "--help":
      return { command: "help" };
    case "list": {
      const unknown = rest.find((token) => token.startsWith("--") && token !== "--all");
      if (unknown !== undefined) {
        return makeError("E_USAGE_UNKNOWN_OPTION", unknown);
      }
      return { command: "list", all: rest.includes("--all") };
    }
    case "add": {
      const option = rest.find((token) => token.startsWith("--"));
      if (option !== undefined) {
        return makeError("E_USAGE_UNKNOWN_OPTION", option);
      }
      if (rest.length === 0) {
        return makeError("E_USAGE_MISSING_ARGUMENT");
      }
      const text = rest.join(" ").trim();
      if (text === "") {
        return makeError("E_USAGE_EMPTY_TEXT");
      }
      return { command: "add", text };
    }
    case "done":
    case "rm":
      return parseId(name, rest);
    default:
      return makeError("E_USAGE_UNKNOWN_OPTION", name);
  }
}
