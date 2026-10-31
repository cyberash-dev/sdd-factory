export type ErrorCode =
  | "E_USAGE_MISSING_ARGUMENT"
  | "E_USAGE_EMPTY_TEXT"
  | "E_USAGE_UNKNOWN_OPTION"
  | "E_USAGE_INVALID_ID"
  | "E_NO_TASK"
  | "E_CANNOT_READ";

export interface CliError {
  readonly code: ErrorCode;
  readonly line: string;
}

const CODES: readonly ErrorCode[] = [
  "E_USAGE_MISSING_ARGUMENT",
  "E_USAGE_EMPTY_TEXT",
  "E_USAGE_UNKNOWN_OPTION",
  "E_USAGE_INVALID_ID",
  "E_NO_TASK",
  "E_CANNOT_READ",
];

function lineFor(code: ErrorCode, subject: string): string {
  switch (code) {
    case "E_USAGE_MISSING_ARGUMENT":
      return "usage: missing argument";
    case "E_USAGE_EMPTY_TEXT":
      return "usage: empty text";
    case "E_USAGE_UNKNOWN_OPTION":
      return `usage: unknown argument ${subject}`;
    case "E_USAGE_INVALID_ID":
      return `usage: invalid id ${subject}`;
    case "E_NO_TASK":
      return `error: no task #${subject}`;
    case "E_CANNOT_READ":
      return `error: cannot read ${subject}`;
  }
}

export function makeError(code: ErrorCode, subject: string = ""): CliError {
  return { code, line: lineFor(code, subject) };
}

export function exitCodeFor(error: CliError): 1 | 2 {
  return error.code.startsWith("E_USAGE_") ? 2 : 1;
}

export function isCliError(value: unknown): value is CliError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const code: unknown = Reflect.get(value, "code");
  const line: unknown = Reflect.get(value, "line");
  return (
    typeof line === "string" &&
    typeof code === "string" &&
    CODES.some((known) => known === code)
  );
}
