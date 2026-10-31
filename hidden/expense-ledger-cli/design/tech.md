# Technical design: expense-ledger-cli

## 1. Overview

`ledger` is a Node.js command-line program that keeps personal expenses in one JSON ledger file at the path in `LEDGER_FILE` (default `./ledger.json` in the current working directory) and reports on them. Five commands — `add`, `list`, `summary`, `rm`, `export` — read and write that file through the Node.js filesystem and print newline-terminated lines on stdout, nothing else. Every failure ends in exactly one stderr line beginning with `usage:` or `error:` and exit code 2 or 1; success is exit 0. The process entry is `node dist/cli.js <command>` and the ledger is a JSON document of expense records holding integer cents. Nothing leaves the machine: no network call and no third-party runtime dependency.

## 2. Module map

### M-01 store
- responsibility: own the persisted ledger document, read and write it at a resolved path, and allocate and retire expense ids without reuse.
- covers: [expense-ledger-cli:CTR-007, expense-ledger-cli:BEH-017, expense-ledger-cli:BEH-018, expense-ledger-cli:INV-001, expense-ledger-cli:EXT-001]
- owns: src/store/**
- entry: src/store/index.ts
- depends_on: []
- public interface:
  ```ts
  export interface ExpenseDraft {
    readonly amountCents: number;
    readonly category: string;
    readonly date: string;
    readonly note?: string;
  }

  export interface Expense extends ExpenseDraft {
    readonly id: number;
  }

  export interface Ledger {
    readonly nextId: number;
    readonly expenses: readonly Expense[];
  }

  export type ReadLedgerResult =
    | { readonly ok: true; readonly ledger: Ledger; readonly exists: boolean }
    | { readonly ok: false; readonly path: string };

  export type WriteLedgerResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly path: string };

  export function resolveLedgerPath(env: Record<string, string | undefined>): string;
  export function readLedger(path: string): ReadLedgerResult;
  export function writeLedger(path: string, ledger: Ledger): WriteLedgerResult;
  export function addExpense(ledger: Ledger, draft: ExpenseDraft): { readonly ledger: Ledger; readonly id: number };
  export function removeExpense(ledger: Ledger, id: number): Ledger | null;
  ```
- notes: raises no `CliError`; reports failure as `{ ok: false, path }` and leaves the mapping to the caller. Uses only `node:fs`, `node:path` and `node:process` (CON-005, EXT-001). Owns the document schema, the id high-water mark (INV-001), the "absent file is an empty ledger, read never creates" rule (BEH-018) and the "any schema violation is unreadable" rule (BEH-017, A-005). `resolveLedgerPath` reads `env.LEDGER_FILE` and never `process.env` directly, so tests inject an environment object.

### M-02 domain
- responsibility: the ledger vocabulary as shared command shapes and pure functions for amounts in integer cents, calendar days and categories.
- covers: [expense-ledger-cli:INV-002, expense-ledger-cli:INV-003, expense-ledger-cli:INV-008]
- owns: src/domain/**
- entry: src/domain/index.ts
- depends_on: []
- public interface:
  ```ts
  export interface AddCommand {
    readonly kind: "add";
    readonly amountCents: number;
    readonly category: string;
    readonly date?: string;
    readonly note?: string;
  }

  export interface ListCommand {
    readonly kind: "list";
    readonly category?: string;
    readonly from?: string;
    readonly to?: string;
  }

  export interface SummaryCommand {
    readonly kind: "summary";
    readonly month?: string;
  }

  export interface RmCommand {
    readonly kind: "rm";
    readonly id: number;
  }

  export type Command =
    | AddCommand
    | ListCommand
    | SummaryCommand
    | RmCommand
    | { readonly kind: "export" }
    | { readonly kind: "help" };

  export function parseAmountToCents(text: string): number | null;
  export function formatAmountCents(cents: number): string;
  export function isCategory(text: string): boolean;
  export function isCalendarDate(text: string): boolean;
  export function isMonth(text: string): boolean;
  export function utcDayOf(now: Date): string;
  ```
- notes: pure, no IO and no ambient clock: `utcDayOf` receives the `Date` from its caller (DD-05). Invalid input is reported as `null` or `false`, never as a thrown error and never as an error code. `formatAmountCents(1250)` is `"12.50"` and `formatAmountCents(5)` is `"0.05"`; `parseAmountToCents("12.5")` is `1250` and `parseAmountToCents("0")` is `null` (A-001, DD-04).

### M-03 diagnostics
- responsibility: the four stable codes, the two diagnostic prefixes, the exit-code mapping and the outcome shape every command returns.
- covers: [expense-ledger-cli:POL-001, expense-ledger-cli:INV-007, expense-ledger-cli:CTR-008]
- owns: src/diagnostics/**
- entry: src/diagnostics/index.ts
- depends_on: []
- public interface:
  ```ts
  export type CliCode = "E_SUCCESS" | "E_USAGE" | "E_NO_EXPENSE" | "E_UNREADABLE_STORE";

  export type CliErrorCode = Exclude<CliCode, "E_SUCCESS">;

  export interface CliError {
    readonly code: CliErrorCode;
    readonly detail: string;
  }

  export type CommandOutcome =
    | { readonly ok: true; readonly lines: readonly string[] }
    | { readonly ok: false; readonly error: CliError };

  export function exitCodeFor(code: CliCode): 0 | 1 | 2;
  export function renderDiagnostic(error: CliError): string;
  export function usageError(detail: string): CliError;
  export function noExpenseError(id: number): CliError;
  export function unreadableStoreError(path: string): CliError;
  ```
- notes: the only module that knows exit codes and prefixes: `exitCodeFor("E_SUCCESS")` is `0`, `"E_USAGE"` is `2`, `"E_NO_EXPENSE"` and `"E_UNREADABLE_STORE"` are `1`. `renderDiagnostic(usageError("no command given"))` is `usage: no command given`; `renderDiagnostic(noExpenseError(7))` is `error: no expense #7`; `renderDiagnostic(unreadableStoreError("/tmp/l.json"))` is `error: cannot read /tmp/l.json`. No code outside `CliCode` exists (POL-001).

### M-04 parse
- responsibility: turn `argv` into a `Command` or an `E_USAGE` diagnostic, and hold the usage text.
- covers: [expense-ledger-cli:BEH-002, expense-ledger-cli:BEH-003, expense-ledger-cli:BEH-004, expense-ledger-cli:BEH-015, expense-ledger-cli:BEH-016, expense-ledger-cli:CTR-006, expense-ledger-cli:POL-002]
- owns: src/parse/**
- entry: src/parse/index.ts
- depends_on: [M-02, M-03]
- public interface:
  ```ts
  import type { Command } from "../domain/index.js";
  import type { CliError } from "../diagnostics/index.js";

  export type ParseResult =
    | { readonly ok: true; readonly command: Command }
    | { readonly ok: false; readonly error: CliError };

  export const USAGE_TEXT: readonly string[];

  export function parseArgv(argv: readonly string[]): ParseResult;
  ```
- notes: raises `E_USAGE` only, always through `usageError`. Validates amount (A-001), category (INV-008 through `isCategory`), `--date` (INV-003 through `isCalendarDate`), `--month` (A-003 through `isMonth`), `rm` id (A-004) and the argv grammar (DD-03). Recognizes `--help` and owns `USAGE_TEXT` (BEH-015, CTR-006). Never touches the ledger file and never reads the clock: `AddCommand.date` stays `undefined` when `--date` is absent.

### M-05 query
- responsibility: execute `list`, `summary` and `export` against the ledger file and return their stdout lines.
- covers: [expense-ledger-cli:BEH-006, expense-ledger-cli:BEH-007, expense-ledger-cli:BEH-008, expense-ledger-cli:BEH-009, expense-ledger-cli:BEH-010, expense-ledger-cli:BEH-011, expense-ledger-cli:BEH-014, expense-ledger-cli:CTR-002, expense-ledger-cli:CTR-003, expense-ledger-cli:CTR-005, expense-ledger-cli:INV-004, expense-ledger-cli:INV-005, expense-ledger-cli:INV-006]
- owns: src/query/**
- entry: src/query/index.ts
- depends_on: [M-01, M-02, M-03]
- public interface:
  ```ts
  import type { ListCommand, SummaryCommand } from "../domain/index.js";
  import type { CommandOutcome } from "../diagnostics/index.js";

  export function runList(command: ListCommand, ledgerPath: string): CommandOutcome;
  export function runSummary(command: SummaryCommand, ledgerPath: string): CommandOutcome;
  export function runExport(ledgerPath: string): CommandOutcome;
  ```
- notes: reads through `readLedger` and never writes the ledger file (SCN-003); a failed read becomes `unreadableStoreError(ledgerPath)` (E_UNREADABLE_STORE). Builds the entire output in memory and returns it as `lines`, so a failing invocation writes no stdout (INV-007). Ordering: `list` by date ascending then id ascending (INV-004), `summary` by total descending then category ascending with the `total` line last (INV-005), `export` by id ascending (INV-006). Filtering: `--from`/`--to` inclusive on the `YYYY-MM-DD` string, an inverted range matches nothing (A-002), `--month` compares the first seven characters of the date (BEH-010). `export` quotes a note containing `,`, `"`, `\n` or `\r` and doubles inner `"` (DD-07, CTR-005).

### M-06 mutate
- responsibility: execute `add` and `rm` against the ledger file and return their stdout lines.
- covers: [expense-ledger-cli:BEH-001, expense-ledger-cli:BEH-005, expense-ledger-cli:BEH-012, expense-ledger-cli:BEH-013, expense-ledger-cli:CTR-001, expense-ledger-cli:CTR-004]
- owns: src/mutate/**
- entry: src/mutate/index.ts
- depends_on: [M-01, M-02, M-03]
- public interface:
  ```ts
  import type { AddCommand, RmCommand } from "../domain/index.js";
  import type { CommandOutcome } from "../diagnostics/index.js";

  export function runAdd(command: AddCommand, ledgerPath: string, now: Date): CommandOutcome;
  export function runRm(command: RmCommand, ledgerPath: string): CommandOutcome;
  ```
- notes: the only command module that writes the ledger file, through `writeLedger` (BEH-018). `runAdd` fills a missing date with `utcDayOf(now)` (BEH-005), allocates the id through `addExpense` (INV-001) and prints `#<id> <amount> <category> <date>`. `runRm` removes through `removeExpense`; a `null` result is `noExpenseError(id)` (E_NO_EXPENSE, BEH-013) and leaves the file untouched. A failed read or write becomes `unreadableStoreError(ledgerPath)` (E_UNREADABLE_STORE).

### M-07 root
- responsibility: the process entry — build the IO boundary, resolve the ledger path, dispatch the parsed command, write stdout or the single diagnostic, and return the exit code.
- covers: [expense-ledger-cli:SCN-001, expense-ledger-cli:SCN-002, expense-ledger-cli:SCN-003, expense-ledger-cli:GEN-001, expense-ledger-cli:CON-001, expense-ledger-cli:CON-002, expense-ledger-cli:CON-003, expense-ledger-cli:CON-004, expense-ledger-cli:CON-005, expense-ledger-cli:CON-006]
- owns: src/index.ts, src/cli.ts, tsconfig.build.json, package.json
- entry: src/index.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05, M-06]
- public interface:
  ```ts
  import { resolveLedgerPath } from "./store/index.js";
  import { parseArgv, USAGE_TEXT } from "./parse/index.js";
  import { runList, runSummary, runExport } from "./query/index.js";
  import { runAdd, runRm } from "./mutate/index.js";
  import { exitCodeFor, renderDiagnostic } from "./diagnostics/index.js";

  export interface CliIo {
    readonly stdout: (line: string) => void;
    readonly stderr: (line: string) => void;
    readonly env: Record<string, string | undefined>;
    readonly now: () => Date;
  }

  export async function main(argv: readonly string[], io: CliIo): Promise<number>;
  ```
- notes: `main` writes every success line through `io.stdout` and, on failure, exactly one line through `io.stderr`, then returns `exitCodeFor(code)`; it never calls `process.exit` and never writes stdout before the outcome is known (INV-007, DD-06). For `{ kind: "help" }` it writes `USAGE_TEXT` without touching the ledger file (BEH-015). `src/cli.ts` is the three-line binary: it calls `main(process.argv.slice(2), io)` with `io.stdout = (line) => process.stdout.write(line + "\n")`, `io.stderr` alike, `io.env = process.env`, `io.now = () => new Date()`, and assigns the result to `process.exitCode`. Owns the emitting build (GEN-001, CON-006, DD-11): `tsconfig.build.json` extends `tsconfig.json` with `outDir: "dist"`, `rootDir: "src"`, `noEmit: false` and compiles `src/cli.ts` to `dist/cli.js`; `package.json` gains `"type": "module"`, `"build": "tsc -p tsconfig.build.json"` and, when absent, `"test": "vitest run"` (CON-003); no other `package.json` key may change.

## 3. Data shapes

`Expense`, `ExpenseDraft`, `Ledger` — M-01, src/store/index.ts:

```ts
export interface ExpenseDraft {
  readonly amountCents: number;
  readonly category: string;
  readonly date: string;
  readonly note?: string;
}

export interface Expense extends ExpenseDraft {
  readonly id: number;
}

export interface Ledger {
  readonly nextId: number;
  readonly expenses: readonly Expense[];
}
```

covers: [expense-ledger-cli:CTR-007, expense-ledger-cli:INV-001, expense-ledger-cli:INV-002, expense-ledger-cli:INV-003]

`ReadLedgerResult`, `WriteLedgerResult` — M-01, src/store/index.ts:

```ts
export type ReadLedgerResult =
  | { readonly ok: true; readonly ledger: Ledger; readonly exists: boolean }
  | { readonly ok: false; readonly path: string };

export type WriteLedgerResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly path: string };
```

covers: [expense-ledger-cli:BEH-017, expense-ledger-cli:BEH-018]

`Command` and its members `AddCommand`, `ListCommand`, `SummaryCommand`, `RmCommand` — M-02, src/domain/index.ts:

```ts
export type Command =
  | AddCommand
  | ListCommand
  | SummaryCommand
  | RmCommand
  | { readonly kind: "export" }
  | { readonly kind: "help" };
```

covers: [expense-ledger-cli:CTR-001, expense-ledger-cli:CTR-002, expense-ledger-cli:CTR-003, expense-ledger-cli:CTR-004, expense-ledger-cli:CTR-005, expense-ledger-cli:CTR-006]

`CliCode`, `CliError`, `CommandOutcome` — M-03, src/diagnostics/index.ts:

```ts
export type CliCode = "E_SUCCESS" | "E_USAGE" | "E_NO_EXPENSE" | "E_UNREADABLE_STORE";

export interface CliError {
  readonly code: Exclude<CliCode, "E_SUCCESS">;
  readonly detail: string;
}

export type CommandOutcome =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly error: CliError };
```

covers: [expense-ledger-cli:POL-001, expense-ledger-cli:CTR-008, expense-ledger-cli:INV-007]

`ParseResult` — M-04, src/parse/index.ts:

```ts
export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly error: CliError };
```

covers: [expense-ledger-cli:BEH-016, expense-ledger-cli:POL-002]

`CliIo` — M-07, src/index.ts:

```ts
export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env: Record<string, string | undefined>;
  readonly now: () => Date;
}
```

covers: [expense-ledger-cli:INV-007, expense-ledger-cli:CTR-008, expense-ledger-cli:CON-002]

## 4. Error mapping

| code | exit code | raising module | stderr line | stdout |
| --- | --- | --- | --- | --- |
| `E_SUCCESS` | 0 | none | none | the command's lines |
| `E_USAGE` | 2 | M-04 parse, through `usageError` | `usage: <detail>` | none |
| `E_NO_EXPENSE` | 1 | M-06 mutate, through `noExpenseError` | `error: no expense #<id>` | none |
| `E_UNREADABLE_STORE` | 1 | detected by M-01 store, raised by M-05 or M-06 through `unreadableStoreError` | `error: cannot read <path>` | none |

Every failing outcome of every approved record maps to exactly one row:

| situation | code | exit | record |
| --- | --- | --- | --- |
| amount not matching `^[0-9]+(\.[0-9]{1,2})?$` or not greater than zero, or a cent value above `Number.MAX_SAFE_INTEGER` | `E_USAGE` | 2 | BEH-002, A-001 |
| category not matching `^[a-z0-9-]{1,20}$` | `E_USAGE` | 2 | BEH-003, INV-008 |
| `--date` value that is not a `YYYY-MM-DD` calendar day | `E_USAGE` | 2 | BEH-004, INV-003 |
| `--month` value that is not `YYYY-MM` with a month 01 to 12 | `E_USAGE` | 2 | BEH-009, BEH-010, BEH-011, A-003 |
| `--category`, `--from`, `--to`, `--date`, `--note` or `--month` without a following token | `E_USAGE` | 2 | BEH-006, BEH-016 |
| unknown command, unknown option, missing positional, extra positional, no command | `E_USAGE` | 2 | BEH-016, A-009 |
| `--help` with a further token | `E_USAGE` | 2 | BEH-015 |
| `ledger export` without `--csv` | `E_USAGE` | 2 | BEH-014, A-008 |
| `rm` id not matching `^[1-9][0-9]*$` or above `Number.MAX_SAFE_INTEGER` | `E_USAGE` | 2 | BEH-012, A-004 |
| `rm` id that names no expense in the ledger, including an absent ledger file | `E_NO_EXPENSE` | 1 | BEH-013, CTR-004 |
| ledger document that is not valid UTF-8 JSON of the ledger schema, or a schema violation in it | `E_UNREADABLE_STORE` | 1 | BEH-017, A-005, CTR-007 |
| a write to the ledger path fails | `E_UNREADABLE_STORE` | 1 | DD-08 |

No other code exists (POL-001, CTR-008). The text after `usage:` is fixed by section 5 but is not contractual; consumers rely on the prefix and the exit code only (INV-007).

## 5. Process and IO boundaries

### 5.1 Invocation

- Build: `npm run build` runs `tsc -p tsconfig.build.json` and emits `dist/cli.js` from `src/cli.ts` (GEN-001, CON-006).
- Run: `node dist/cli.js <argv...>` on Node.js 22 or newer (CON-002). `argv` is `process.argv.slice(2)`.
- stdin is never read. No command prompts, paginates or waits.
- No network socket, DNS lookup or `fetch` occurs at build time or run time (CON-004).
- Tests import the module entries under `src/` and call `main` with an injected `CliIo`; only the GEN-001 test runs the build and the built binary.

### 5.2 argv grammar

```
ledger      ::= "--help" | command
command     ::= add | list | summary | rm | export
add         ::= <amount> <category> { option }
list        ::= { option }
summary     ::= { option }
rm          ::= <id>
export      ::= "--csv"
option      ::= "--date" <token> | "--note" <token>
              | "--category" <token> | "--from" <token> | "--to" <token>
              | "--month" <token>
```

- Tokens are the shell words of the invocation; `ledger` is not part of `argv`.
- `argv` of length 0 is `E_USAGE` with detail `no command given` (A-009).
- `argv` equal to `["--help"]` is the help command: exit 0, `USAGE_TEXT` on stdout, no ledger access (BEH-015, CTR-006). `["--help", <anything>]` is `E_USAGE` with detail `--help takes no arguments`.
- The first token otherwise names the command; any other first token is `E_USAGE` with detail `unknown command "<token>"`.
- After the command, tokens are scanned left to right. A token starting with `--` is an option; `--csv` is a value-less flag accepted by `export` only. Every other option consumes the following token verbatim as its value, even when that token starts with `-`; a missing following token is `E_USAGE` with detail `option <name> needs a value`.
- An option not listed for the command is `E_USAGE` with detail `unknown option "<token>"`. `--` is not a terminator and is reported as an unknown option.
- A repeated option keeps its last value and earlier occurrences are ignored (A-006).
- Non-option tokens are positionals in order. A surplus positional is `E_USAGE` with detail `unexpected argument "<token>"`; a missing one is `E_USAGE` with detail `missing argument <amount>`, `missing argument <category>` or `missing argument <id>`.
- `export` without `--csv` is `E_USAGE` with detail `export needs --csv` (A-008).

The `usage:` details M-04 emits are exactly: `no command given`, `unknown command "<token>"`, `unknown option "<token>"`, `option <name> needs a value`, `unexpected argument "<token>"`, `missing argument <amount>`, `missing argument <category>`, `missing argument <id>`, `invalid amount "<text>"`, `invalid category "<text>"`, `invalid date "<text>"`, `invalid month "<text>"`, `invalid id "<text>"`, `export needs --csv`, `--help takes no arguments`.

`USAGE_TEXT` is an ordered array of lines naming `add`, `list`, `summary`, `rm`, `export` and `--help`, each with its argument shape as written in CTR-001 to CTR-006.

### 5.3 Environment

- `LEDGER_FILE` names the ledger file (CTR-007, EXT-001). When it is unset or the empty string, the raw path is `ledger.json`.
- The resolved path is `path.resolve(process.cwd(), raw)`, an absolute path; it is computed once per invocation in M-07 through `resolveLedgerPath` (DD-09).
- No other environment variable is read. `TZ` does not affect any output: every date is derived from UTC (`utcDayOf`).

### 5.4 Files

- Encoding: UTF-8 for reading and writing.
- The ledger document written by M-01 is a JSON object: `{"next_id": <integer>, "expenses": [<expense>, ...]}` (DD-01, DD-02).
- An expense object is `{"id": <integer>, "amount_cents": <integer>, "category": <string>, "date": "YYYY-MM-DD"}` plus `"note": <string>` when the expense has a note (CTR-007, INV-002, INV-003).
- A document is readable when it is either that object with a `next_id` integer of at least 1, unique positive integer ids, `amount_cents` positive integers, categories matching `^[a-z0-9-]{1,20}$`, dates that are `YYYY-MM-DD` calendar days and notes that are strings, or a bare JSON array of such expense objects (an older-version file, CTR-007 compatibility). A bare array reads as `next_id = max(id) + 1`, or 1 for an empty array.
- Any other document, including truncated JSON, a JSON scalar, a root object with a missing or mistyped field, or an array holding a malformed expense, is unreadable: `E_UNREADABLE_STORE` (BEH-017, A-005).
- An absent file reads as the empty ledger `{ nextId: 1, expenses: [] }` with `exists: false`; reading never creates it (BEH-018, SCN-003).
- The file is written with `fs.writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8")` after a successful mutation; a direct write, no temporary file and no rename (DD-10). Only `add` and `rm` write.

### 5.5 stdout

- Each output line is written as the line text followed by `"\n"`, UTF-8, no trailing spaces and no blank lines.
- An invocation that prints nothing writes zero bytes (BEH-008, SCN-003).
- A failing invocation writes zero bytes to stdout (INV-007).
- Line layouts: `#<id> <amount> <category> <date>` for `add` (CTR-001); `#<id> <date> <amount> <category>` optionally followed by ` — <note>` for `list`, where the separator is one space, U+2014 EM DASH and one space (CTR-002); `<category> <total>` lines then `total <total>` for `summary` (CTR-003); `#<id> removed` for `rm` (CTR-004); the CSV for `export` (CTR-005); `USAGE_TEXT` for `--help` (CTR-006).
- Every rendered amount is `formatAmountCents`: exactly two decimals, no thousands separator, no currency sign (INV-002).

### 5.6 stderr

- A failing invocation writes exactly one line, the `renderDiagnostic` result plus `"\n"`, and nothing else; a successful invocation writes zero bytes to stderr (CTR-008, INV-007).
- No stack trace, warning or extra line reaches stderr: every module returns outcomes instead of throwing, and `src/cli.ts` catches nothing because nothing throws by contract (POL-002).

### 5.7 Exit

- `src/cli.ts` assigns `process.exitCode = await main(...)` and returns; `process.exit()` is never called, so stdout and stderr are flushed by normal process termination.
- `0` success, `1` error exit (`E_NO_EXPENSE`, `E_UNREADABLE_STORE`), `2` usage error (`E_USAGE`) (CTR-008).

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@5.6.3", "vitest@2.1.8", "@types/node@22.10.2"]
  tsconfig: { module: NodeNext, moduleResolution: NodeNext, target: ES2022, strict: true, noEmit: true }
```

`dependencies` is empty because CON-005 forbids third-party runtime dependencies. `typescript`, `vitest` and `@types/node` are the only packages; CON-003 fixes vitest as the test runner. The emitting build of GEN-001 uses the separate `tsconfig.build.json` owned by M-07 (DD-11), which is why `tsconfig` keeps `noEmit: true` and sets no `rootDir`.

## 7. Design decisions

### DD-01 Ledger document root and the id high-water mark
- evidence: [expense-ledger-cli:CTR-007, expense-ledger-cli:INV-001, expense-ledger-cli:SCN-002, expense-ledger-cli:BEH-017, expense-ledger-cli:A-005]
- decision: the ledger file root is the object `{"next_id": <integer>, "expenses": [...]}`. `next_id` is the id the next `add` uses; `add` writes `next_id + 1`, and on a file whose `next_id` is not above every stored id it uses `max(id) + 1`. A bare JSON array of valid expense objects is also accepted on read as an older-version file with `next_id = max(id) + 1`; every other document is unreadable.
- alternatives_rejected: a bare array root only — rejected because after `rm` of the highest id the remaining array holds no trace of that id, so the next `add` would reuse it, breaking INV-001 and step 2 of SCN-002; tombstones inside the array — rejected because `rm` must leave the ledger holding only the other expenses (BEH-012) and export must emit one row per expense (CTR-005); a second counter file beside the ledger — rejected because the records define exactly one persisted artifact (CTR-007).
- consequence: the schema-violation rule of A-005 still holds operationally — a document that is neither the ledger object nor an array of valid expenses is unreadable and exits 1 — while INV-001 and SCN-002 become satisfiable. A document that is the ledger object with a wrong field type is unreadable, not repaired.

### DD-02 Persisted field names
- evidence: [expense-ledger-cli:CTR-007, expense-ledger-cli:INV-002]
- decision: the file stores `id`, `amount_cents`, `category`, `date`, optional `note` and the root's `next_id`, all snake_case; the in-memory shape uses `amountCents`. The mapping lives in M-01 alone.
- alternatives_rejected: storing `amountCents` in the file — rejected because CTR-007 names the field `amount_cents`; storing the amount as a decimal string — rejected because INV-002 requires integer cents.
- consequence: tests that inspect the file read `amount_cents`; every other module sees `amountCents`.

### DD-03 Hand-written argv parser
- evidence: [expense-ledger-cli:CON-005, expense-ledger-cli:BEH-016, expense-ledger-cli:A-006, expense-ledger-cli:A-009]
- decision: `parseArgv` scans tokens left to right: a `--name` token consumes the next token verbatim as its value, `--csv` is a flag, every other token is a positional in order; a repeated option keeps its last value; options may appear before, between or after positionals; `--` has no special meaning.
- alternatives_rejected: a third-party parser such as `commander` — rejected because CON-005 forbids runtime dependencies; a strict positional-then-options grammar — rejected because it would reject invocations the records never forbid and add usage errors the spec does not list.
- consequence: every grammar violation is one `E_USAGE` with one of the details listed in section 5.2, so BEH-016's "one stderr line" holds.

### DD-04 Amounts as string arithmetic
- evidence: [expense-ledger-cli:INV-002, expense-ledger-cli:BEH-002, expense-ledger-cli:A-001]
- decision: `parseAmountToCents` matches `^[0-9]+(\.[0-9]{1,2})?$`, splits the string on `.`, pads the fraction to two digits and computes `whole * 100 + fraction` in integer arithmetic; it returns `null` when the regex fails, when the value is zero, or when the cent value exceeds `Number.MAX_SAFE_INTEGER`. `formatAmountCents` divides by 100 with `Math.trunc` and pads the remainder to two digits. Leading zeros are accepted (`012` stores 1200 cents) because A-001 defines the accepted form by that regular expression.
- alternatives_rejected: `parseFloat` and float multiplication — rejected because `12.5 * 100` and similar values can drift below the integer INV-002 requires; a decimal library — rejected because CON-005 forbids runtime dependencies.
- consequence: every stored amount is an integer and every rendered amount has two decimals, including `0.05` and `30.00`.

### DD-05 Calendar days without `Date` string parsing
- evidence: [expense-ledger-cli:INV-003, expense-ledger-cli:BEH-004, expense-ledger-cli:BEH-005, expense-ledger-cli:A-003]
- decision: `isCalendarDate` validates `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` and then checks the month 01 to 12 and the day against a days-per-month table with the leap rule for February; it never passes the text to `new Date(...)`. `isMonth` validates `^[0-9]{4}-(0[1-9]|1[0-2])$`. `utcDayOf(now)` renders `getUTCFullYear`, `getUTCMonth` and `getUTCDate` of the `Date` its caller supplies, zero-padded.
- alternatives_rejected: `new Date("2026-02-30")` — rejected because it silently rolls over to March and would store a day the user did not write; `toISOString()` for the default date — accepted in effect but implemented through the UTC getters so the result does not depend on the process time zone beyond UTC.
- consequence: `--date 2026-02-30` is `E_USAGE` (BEH-004, INV-003), `--date 2024-02-29` is accepted, and the default date is the UTC day of the injected clock (BEH-005).

### DD-06 Outcomes instead of thrown errors or direct IO
- evidence: [expense-ledger-cli:INV-007, expense-ledger-cli:CTR-008, expense-ledger-cli:POL-001, expense-ledger-cli:POL-002]
- decision: every command module returns a `CommandOutcome` holding the complete list of stdout lines or one `CliError`; M-07 alone writes to stdout, stderr and the exit code, and `main` writes stdout only after a successful outcome.
- alternatives_rejected: writing lines as they are produced — rejected because a late failure would leave partial stdout, breaking INV-007; throwing exceptions across modules — rejected because POL-002 requires a diagnostic instead of an uncaught trace and because a catch-all would still need the same outcome mapping.
- consequence: the failure path cannot emit stdout, and `main` is the only place that knows about `process`.

### DD-07 Local CSV quoting
- evidence: [expense-ledger-cli:CTR-005, expense-ledger-cli:BEH-014, expense-ledger-cli:CON-005]
- decision: `runExport` renders each field itself: a note containing `,`, `"`, `\n` or `\r` is wrapped in `"` with every inner `"` doubled; `id`, `date`, the two-decimal amount and `category` are never quoted because their character sets cannot contain those characters; an absent note is an empty field; rows are terminated with `\n`.
- alternatives_rejected: a CSV library — rejected because CON-005 forbids runtime dependencies; quoting every field — rejected because CTR-005 quotes only notes and the header is written literally.
- consequence: the header is exactly `id,date,amount,category,note` and a note such as `lunch, with team` becomes `"lunch, with team"`.

### DD-08 Storage failures share `E_UNREADABLE_STORE`
- evidence: [expense-ledger-cli:POL-001, expense-ledger-cli:CTR-008, expense-ledger-cli:POL-002]
- decision: a failed read and a failed write both map to `E_UNREADABLE_STORE` with the line `error: cannot read <path>`. The taxonomy in CTR-008 and POL-001 has no other storage code and no new code may be introduced.
- alternatives_rejected: a new `E_UNWRITABLE_STORE` code — rejected because POL-001 forbids a code outside the four; letting the filesystem error escape as an exception — rejected because POL-002 requires one diagnostic line and exit 1.
- consequence: an unwritable ledger path exits 1 with the read diagnostic; the code stays total over four values.

### DD-09 Path resolution and the `<path>` in the diagnostic
- evidence: [expense-ledger-cli:CTR-007, expense-ledger-cli:BEH-017, expense-ledger-cli:EXT-001]
- decision: `resolveLedgerPath(env)` takes `env.LEDGER_FILE` when it is a non-empty string and `"ledger.json"` otherwise, then returns `path.resolve(process.cwd(), raw)`; the same resolved absolute path is used for every read, every write and as `<path>` in the unreadable diagnostic.
- alternatives_rejected: keeping the raw value in the diagnostic — rejected because two spellings of one file (`./ledger.json`, `ledger.json`) would then produce two different messages for the same failure; resolving against `__dirname` — rejected because CTR-007 fixes the current working directory.
- consequence: `error: cannot read /abs/path/ledger.json` names the exact file the command tried, and tests assert the resolved absolute path.

### DD-10 Direct synchronous write of the ledger document
- evidence: [expense-ledger-cli:CTR-007, expense-ledger-cli:BEH-018, expense-ledger-cli:CON-002]
- decision: M-01 writes with one `fs.writeFileSync(path, text, "utf8")` call where `text` is `JSON.stringify(doc, null, 2)` followed by one `"\n"`, after the whole new ledger has been computed; no temporary file, no rename, no file lock.
- alternatives_rejected: write-then-rename through a temporary path — rejected because it creates a second file name the records do not describe and adds an unhandled rename failure; append-only writes — rejected because `rm` and the `next_id` update rewrite the document.
- consequence: the written bytes are deterministic, a failed write leaves the previous document in place or truncates it, and concurrent access stays out of scope as section 19 states.

### DD-11 Emitting build and module type
- evidence: [expense-ledger-cli:GEN-001, expense-ledger-cli:CON-006, expense-ledger-cli:CON-001]
- decision: `package.json` carries `"type": "module"` and `"build": "tsc -p tsconfig.build.json"`; `tsconfig.build.json` extends `tsconfig.json` with `outDir: "dist"`, `rootDir: "src"`, `noEmit: false` and `include: ["src"]`, so `src/cli.ts` compiles to `dist/cli.js` and its `./index.js` imports resolve inside `dist`. The root `tsconfig.json` stays non-emitting for the verifier.
- alternatives_rejected: emitting from the shared `tsconfig.json` — rejected because a `rootDir` there breaks type-checking of `tests/`; a bundler — rejected because CON-005 and the tooling block admit no build dependency beyond `typescript`.
- consequence: `npm run build` produces exactly `dist/cli.js` and `node dist/cli.js --help` exits 0 (GEN-001), and `dist/` is never committed or imported by tests.

### DD-12 Note presence
- evidence: [expense-ledger-cli:A-007, expense-ledger-cli:BEH-006, expense-ledger-cli:CTR-005]
- decision: a note is any string stored verbatim, including the empty string. `list` appends ` — <note>` when the `note` field is defined, so `--note ""` prints the separator followed by nothing; `export` writes the note value, so an absent note and an empty note both render as an empty field.
- alternatives_rejected: treating the empty string as absent — rejected because A-007 says the suffix is printed whenever the note is present and a note is any string; rejecting an empty note — rejected because A-007 explicitly allows it.
- consequence: `note === undefined` is the only "no note" state and no command validates note content.

## 8. Traceability

| spec id | module | where enforced |
| --- | --- | --- |
| expense-ledger-cli:BEH-001 | M-06 | `runAdd` prints `#<id> <amount> <category> <date>` |
| expense-ledger-cli:BEH-002 | M-04 | `parseArgv` amount validation |
| expense-ledger-cli:BEH-003 | M-04 | `parseArgv` category validation |
| expense-ledger-cli:BEH-004 | M-04 | `parseArgv` `--date` validation |
| expense-ledger-cli:BEH-005 | M-06 | `utcDayOf(now)` when `AddCommand.date` is undefined |
| expense-ledger-cli:BEH-006 | M-05 | `runList` line layout and ordering |
| expense-ledger-cli:BEH-007 | M-05 | `runList` category and inclusive range filters |
| expense-ledger-cli:BEH-008 | M-05 | `runList` empty result yields no lines |
| expense-ledger-cli:BEH-009 | M-05 | `runSummary` category and total lines |
| expense-ledger-cli:BEH-010 | M-05 | `runSummary` month filter |
| expense-ledger-cli:BEH-011 | M-05 | `runSummary` empty ledger prints `total 0.00` |
| expense-ledger-cli:BEH-012 | M-06 | `runRm` removal and confirmation line |
| expense-ledger-cli:BEH-013 | M-06 | `runRm` `noExpenseError` on an unknown id |
| expense-ledger-cli:BEH-014 | M-05 | `runExport` header, rows and quoting |
| expense-ledger-cli:BEH-015 | M-04 | `--help` recognition and `USAGE_TEXT` |
| expense-ledger-cli:BEH-016 | M-04 | grammar violations become `E_USAGE` |
| expense-ledger-cli:BEH-017 | M-01 | `readLedger` schema validation |
| expense-ledger-cli:BEH-018 | M-01 | `readLedger` absent file, `writeLedger` creates |
| expense-ledger-cli:SCN-001 | M-07 | `main` dispatch across all five commands |
| expense-ledger-cli:SCN-002 | M-07 | end-to-end id continuation after `rm` |
| expense-ledger-cli:SCN-003 | M-07 | read-only commands on an absent file |
| expense-ledger-cli:CTR-001 | M-06 | `runAdd` contract |
| expense-ledger-cli:CTR-002 | M-05 | `runList` contract |
| expense-ledger-cli:CTR-003 | M-05 | `runSummary` contract |
| expense-ledger-cli:CTR-004 | M-06 | `runRm` contract |
| expense-ledger-cli:CTR-005 | M-05 | `runExport` contract |
| expense-ledger-cli:CTR-006 | M-04 | `--help` contract and `USAGE_TEXT` |
| expense-ledger-cli:CTR-007 | M-01 | path resolution and document schema |
| expense-ledger-cli:CTR-008 | M-03 | codes, prefixes, exit codes |
| expense-ledger-cli:INV-001 | M-01 | `addExpense` and `next_id` allocation |
| expense-ledger-cli:INV-002 | M-02 | `parseAmountToCents` and `formatAmountCents` |
| expense-ledger-cli:INV-003 | M-02 | `isCalendarDate` and `utcDayOf` |
| expense-ledger-cli:INV-004 | M-05 | `runList` sort by date then id |
| expense-ledger-cli:INV-005 | M-05 | `runSummary` sort by total then category |
| expense-ledger-cli:INV-006 | M-05 | `runExport` sort by id |
| expense-ledger-cli:INV-007 | M-03 | `CommandOutcome` and `renderDiagnostic` |
| expense-ledger-cli:INV-008 | M-02 | `isCategory` |
| expense-ledger-cli:EXT-001 | M-01 | `node:fs`, `node:path` and `resolveLedgerPath` |
| expense-ledger-cli:GEN-001 | M-07 | `tsconfig.build.json` emitting `dist/cli.js` |
| expense-ledger-cli:POL-001 | M-03 | the closed four-value `CliCode` |
| expense-ledger-cli:POL-002 | M-04 | boundary validation before any use |
| expense-ledger-cli:CON-001 | M-07 | strict TypeScript with ES modules |
| expense-ledger-cli:CON-002 | M-07 | Node.js 22 runtime and `CliIo` |
| expense-ledger-cli:CON-003 | M-07 | `npm test` wired to `vitest run` |
| expense-ledger-cli:CON-004 | M-07 | no network module is imported anywhere |
| expense-ledger-cli:CON-005 | M-07 | empty `dependencies` |
| expense-ledger-cli:CON-006 | M-07 | `npm run build` and `node dist/cli.js` |

## 9. Revisions

none
