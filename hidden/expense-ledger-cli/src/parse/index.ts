import {
  isCalendarDate,
  isCategory,
  isMonth,
  parseAmountToCents,
  type Command,
} from "../domain/index.js";
import { usageError, type CliError } from "../diagnostics/index.js";

export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly error: CliError };

export const USAGE_TEXT: readonly string[] = [
  "usage: ledger <command> [options]",
  "  add <amount> <category> [--date YYYY-MM-DD] [--note text]   record an expense",
  "  list [--category name] [--from YYYY-MM-DD] [--to YYYY-MM-DD]   show expenses",
  "  summary [--month YYYY-MM]   total expenses per category",
  "  rm <id>   remove an expense",
  "  export --csv   print all expenses as CSV",
  "  --help   show this text",
];

interface CommandGrammar {
  readonly positionals: readonly string[];
  readonly valueOptions: readonly string[];
  readonly flagOptions: readonly string[];
}

const GRAMMARS: Readonly<Record<string, CommandGrammar>> = {
  add: { positionals: ["amount", "category"], valueOptions: ["--date", "--note"], flagOptions: [] },
  list: { positionals: [], valueOptions: ["--category", "--from", "--to"], flagOptions: [] },
  summary: { positionals: [], valueOptions: ["--month"], flagOptions: [] },
  rm: { positionals: ["id"], valueOptions: [], flagOptions: [] },
  export: { positionals: [], valueOptions: [], flagOptions: ["--csv"] },
};

const ID_PATTERN = /^[1-9]\d*$/;

interface Scanned {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string>;
}

function fail(detail: string): ParseResult {
  return { ok: false, error: usageError(detail) };
}

function scan(
  grammar: CommandGrammar,
  tokens: readonly string[],
): Scanned | CliError {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("--")) {
      if (positionals.length >= grammar.positionals.length) {
        return usageError(`unexpected argument "${token}"`);
      }
      positionals.push(token);
    } else if (grammar.flagOptions.includes(token)) {
      options.set(token, "");
    } else if (grammar.valueOptions.includes(token)) {
      const value = tokens[index + 1];
      if (value === undefined) {
        return usageError(`option ${token} needs a value`);
      }
      options.set(token, value);
      index += 1;
    } else {
      return usageError(`unknown option "${token}"`);
    }
  }
  return { positionals, options };
}

function isCliError(value: Scanned | CliError): value is CliError {
  return "code" in value;
}

function invalidDate(options: ReadonlyMap<string, string>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = options.get(name);
    if (value !== undefined && !isCalendarDate(value)) {
      return `invalid date "${value}"`;
    }
  }
  return null;
}

function buildAdd(positionals: readonly string[], options: ReadonlyMap<string, string>): ParseResult {
  const amountText = positionals[0] ?? "";
  const category = positionals[1] ?? "";
  const amountCents = parseAmountToCents(amountText);
  if (amountCents === null) {
    return fail(`invalid amount "${amountText}"`);
  }
  if (!isCategory(category)) {
    return fail(`invalid category "${category}"`);
  }
  const dateProblem = invalidDate(options, ["--date"]);
  if (dateProblem !== null) {
    return fail(dateProblem);
  }
  const date = options.get("--date");
  const note = options.get("--note");
  return {
    ok: true,
    command: {
      kind: "add",
      amountCents,
      category,
      date,
      ...(note === undefined ? {} : { note }),
    },
  };
}

function buildList(options: ReadonlyMap<string, string>): ParseResult {
  const category = options.get("--category");
  if (category !== undefined && !isCategory(category)) {
    return fail(`invalid category "${category}"`);
  }
  const dateProblem = invalidDate(options, ["--from", "--to"]);
  if (dateProblem !== null) {
    return fail(dateProblem);
  }
  const from = options.get("--from");
  const to = options.get("--to");
  return {
    ok: true,
    command: {
      kind: "list",
      ...(category === undefined ? {} : { category }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    },
  };
}

function buildSummary(options: ReadonlyMap<string, string>): ParseResult {
  const month = options.get("--month");
  if (month !== undefined && !isMonth(month)) {
    return fail(`invalid month "${month}"`);
  }
  return { ok: true, command: { kind: "summary", ...(month === undefined ? {} : { month }) } };
}

function buildRm(positionals: readonly string[]): ParseResult {
  const idText = positionals[0] ?? "";
  const id = Number(idText);
  if (!ID_PATTERN.test(idText) || !Number.isSafeInteger(id)) {
    return fail(`invalid id "${idText}"`);
  }
  return { ok: true, command: { kind: "rm", id } };
}

export function parseArgv(argv: readonly string[]): ParseResult {
  const [name, ...rest] = argv;
  if (name === undefined) {
    return fail("no command given");
  }
  if (name === "--help") {
    return rest.length === 0
      ? { ok: true, command: { kind: "help" } }
      : fail("--help takes no arguments");
  }
  const grammar = Object.hasOwn(GRAMMARS, name) ? GRAMMARS[name] : undefined;
  if (grammar === undefined) {
    return fail(`unknown command "${name}"`);
  }
  const scanned = scan(grammar, rest);
  if (isCliError(scanned)) {
    return { ok: false, error: scanned };
  }
  const missing = grammar.positionals[scanned.positionals.length];
  if (missing !== undefined) {
    return fail(`missing argument <${missing}>`);
  }
  switch (name) {
    case "add":
      return buildAdd(scanned.positionals, scanned.options);
    case "list":
      return buildList(scanned.options);
    case "summary":
      return buildSummary(scanned.options);
    case "rm":
      return buildRm(scanned.positionals);
    default:
      return scanned.options.has("--csv")
        ? { ok: true, command: { kind: "export" } }
        : fail("export needs --csv");
  }
}
