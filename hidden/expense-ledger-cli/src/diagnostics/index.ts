export type CliCode = "E_SUCCESS" | "E_USAGE" | "E_NO_EXPENSE" | "E_UNREADABLE_STORE";

export type CliErrorCode = Exclude<CliCode, "E_SUCCESS">;

export interface CliError {
  readonly code: CliErrorCode;
  readonly detail: string;
}

export type CommandOutcome =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly error: CliError };

const EXIT_CODES: Record<CliCode, 0 | 1 | 2> = {
  E_SUCCESS: 0,
  E_USAGE: 2,
  E_NO_EXPENSE: 1,
  E_UNREADABLE_STORE: 1,
};

export function exitCodeFor(code: CliCode): 0 | 1 | 2 {
  return EXIT_CODES[code];
}

export function renderDiagnostic(error: CliError): string {
  const prefix = error.code === "E_USAGE" ? "usage:" : "error:";
  return `${prefix} ${error.detail}`;
}

export function usageError(detail: string): CliError {
  return { code: "E_USAGE", detail };
}

export function noExpenseError(id: number): CliError {
  return { code: "E_NO_EXPENSE", detail: `no expense #${id}` };
}

export function unreadableStoreError(path: string): CliError {
  return { code: "E_UNREADABLE_STORE", detail: `cannot read ${path}` };
}
