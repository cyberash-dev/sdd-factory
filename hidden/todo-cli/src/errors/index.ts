export type ErrorCode = "E_USAGE" | "E_NO_TASK" | "E_STORAGE";

export interface CliError {
  readonly code: ErrorCode;
  readonly exitCode: 1 | 2;
  readonly message: string;
}

export type CommandResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly error: CliError };

export function usageError(detail: string): CliError {
  return { code: "E_USAGE", exitCode: 2, message: `usage: ${detail}` };
}

export function noTaskError(id: number): CliError {
  return { code: "E_NO_TASK", exitCode: 1, message: `error: no task #${id}` };
}

export function storageError(path: string): CliError {
  return { code: "E_STORAGE", exitCode: 1, message: `error: cannot read ${path}` };
}

export function formatErrorLine(error: CliError): string {
  return error.message;
}

export function isCliError(value: unknown): value is CliError {
  if (typeof value !== "object" || value === null) return false;
  const { code, exitCode, message } = value as Record<string, unknown>;
  return (
    (code === "E_USAGE" || code === "E_NO_TASK" || code === "E_STORAGE") &&
    (exitCode === 1 || exitCode === 2) &&
    typeof message === "string"
  );
}
