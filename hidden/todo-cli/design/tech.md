# Technical design: todo-cli

## 1. Overview

`todo` is a short-lived TypeScript command-line process that resolves one storage file path from `TODO_FILE` (default `./todo.json`), performs exactly one command (`add`, `list`, `done`, `rm`, `--help`), writes at most one line set to stdout and exits with 0, 1 or 2. Task records live in a UTF-8 JSON file of the contract shape `{"nextId": n, "tasks": [...]}`; a new task receives `nextId` and `nextId` is bumped, so a removed id is never handed out again. Failure classes are fixed: argument mistakes are exit 2 with one `usage:` stderr line, store failures are exit 1 with one `error:` stderr line. There is no network, no stdin, no interactive mode and no concurrency handling.

## 2. Module map

### M-01 errors
- responsibility: Own the error code vocabulary, the stderr line of each code and the exit code of each code.
- covers: [todo-cli:POL-001, todo-cli:INV-005]
- owns: src/errors/**
- entry: src/errors/index.ts
- depends_on: []
- public interface:
  ```ts
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

  export function makeError(code: ErrorCode, subject?: string): CliError;
  export function exitCodeFor(error: CliError): 1 | 2;
  export function isCliError(value: unknown): value is CliError;
  ```
- notes: total mapping of code to stderr line (DD-01): `usage: missing argument` for E_USAGE_MISSING_ARGUMENT, `usage: empty text` for E_USAGE_EMPTY_TEXT, `usage: unknown argument <subject>` for E_USAGE_UNKNOWN_OPTION, `usage: invalid id <subject>` for E_USAGE_INVALID_ID, `error: no task #<subject>` for E_NO_TASK, `error: cannot read <subject>` for E_CANNOT_READ. `line` never carries a trailing newline. Exit codes: every `E_USAGE_*` and E_USAGE_* family is 2, E_NO_TASK and E_CANNOT_READ are 1. No state is held.

### M-02 store
- responsibility: Resolve the storage path, read the storage file into a validated task list, write a task list back, and format `createdAt` values.
- covers: [todo-cli:CTR-006, todo-cli:CTR-007, todo-cli:BEH-016, todo-cli:BEH-017, todo-cli:BEH-018, todo-cli:BEH-019, todo-cli:INV-001, todo-cli:INV-002, todo-cli:INV-003, todo-cli:INV-006, todo-cli:INV-007, todo-cli:POL-003]
- owns: src/store/**
- entry: src/store/index.ts
- depends_on: []
- public interface:
  ```ts
  export interface Task {
    readonly id: number;
    readonly text: string;
    readonly done: boolean;
    readonly createdAt: string;
  }

  export interface TaskList {
    readonly nextId: number;
    readonly tasks: readonly Task[];
  }

  export type StoreResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false };

  export function resolveStorePath(env: Readonly<Record<string, string | undefined>>): string;
  export function emptyTaskList(): TaskList;
  export function readTaskList(path: string): StoreResult<TaskList>;
  export function writeTaskList(path: string, list: TaskList): StoreResult<null>;
  export function formatCreatedAt(date: Date): string;
  ```
- notes: `ok: false` means the file exists and cannot be parsed as JSON, does not match the contract shape, or cannot be written; the module never creates a file on read, so read-only commands leave an absent file absent (INV-007) and every write is a single explicit `writeTaskList` call (INV-006). Validation of the read file: root is a non-array object whose `nextId` is an integer at least 1 and whose `tasks` is an array of objects with integer `id` at least 1, non-empty `text`, boolean `done` and `createdAt` string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`; ids strictly ascending and therefore unique (INV-001, INV-002). A file of any other shape is `ok: false` and stays byte-unchanged (POL-003).

### M-03 args
- responsibility: Turn argv into one parsed command or one usage error.
- covers: [todo-cli:BEH-012, todo-cli:BEH-013, todo-cli:BEH-014, todo-cli:BEH-015, todo-cli:BEH-021, todo-cli:POL-002]
- owns: src/args/**
- entry: src/args/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { CliError } from "../errors/index.js";

  export type ParsedCommand =
    | { readonly command: "help" }
    | { readonly command: "add"; readonly text: string }
    | { readonly command: "list"; readonly all: boolean }
    | { readonly command: "done"; readonly idToken: string }
    | { readonly command: "rm"; readonly idToken: string };

  export function parseArgs(argv: readonly string[]): ParsedCommand | CliError;
  ```
- notes: raises E_USAGE_MISSING_ARGUMENT, E_USAGE_EMPTY_TEXT, E_USAGE_UNKNOWN_OPTION, E_USAGE_INVALID_ID. Parsing never reads the storage file, which is what makes argument errors win over store errors (BEH-021). Returns `CliError` itself (not a union wrapper) so the caller discriminates with `isCliError`. `idToken` keeps the token exactly as typed (ASM-005, ASM-011).

### M-04 commands
- responsibility: Apply one parsed command to an in-memory task list and produce the stdout lines plus the list to persist.
- covers: [todo-cli:BEH-001, todo-cli:BEH-002, todo-cli:BEH-003, todo-cli:BEH-004, todo-cli:BEH-005, todo-cli:BEH-006, todo-cli:BEH-007, todo-cli:BEH-008, todo-cli:BEH-009, todo-cli:BEH-010, todo-cli:BEH-011, todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:INV-004]
- owns: src/commands/**
- entry: src/commands/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { CliError } from "../errors/index.js";
  import type { TaskList } from "../store/index.js";
  import { formatCreatedAt } from "../store/index.js";

  export type CommandOutcome =
    | { readonly ok: true; readonly lines: readonly string[]; readonly list: TaskList | null }
    | { readonly ok: false; readonly error: CliError };

  export function runAdd(list: TaskList, text: string, clock: () => Date): CommandOutcome;
  export function runList(list: TaskList, all: boolean): CommandOutcome;
  export function runDone(list: TaskList, idToken: string): CommandOutcome;
  export function runRm(list: TaskList, idToken: string): CommandOutcome;
  ```
- notes: raises E_NO_TASK only. `list: null` means the file must not be written (list). Line formats: `#<id> <text>`, `[x] #<id> <text>`, `#<token> done`, `#<token> removed`; `#<token>` echoes the typed token (ASM-011). `runList` sorts ascending by id (INV-004) and prints nothing for an empty selection. `runAdd` builds the task with `id = list.nextId`, `done = false`, `createdAt = formatCreatedAt(clock())` and returns `nextId + 1`. `runDone` on an already completed task returns the same line and an unchanged list value; it still returns a list, and writing an identical list is allowed. `runRm` removes the task and leaves every other id untouched.

### M-05 root
- responsibility: Wire argv, environment, storage and commands into one process run: resolve the path, read, execute, write, print, return the exit code; own the built entry point.
- covers: [todo-cli:BEH-020, todo-cli:CTR-005, todo-cli:SCN-001, todo-cli:SCN-002, todo-cli:SCN-003, todo-cli:NFR-001, todo-cli:CON-001, todo-cli:CON-002, todo-cli:GA-001, todo-cli:IMP-001]
- owns: src/index.ts, src/cli.ts, tsconfig.build.json
- entry: src/index.ts
- depends_on: [M-01, M-02, M-03, M-04]
- public interface:
  ```ts
  import { isCliError, exitCodeFor } from "./errors/index.js";
  import { readTaskList, resolveStorePath, writeTaskList } from "./store/index.js";
  import { parseArgs } from "./args/index.js";
  import { runAdd, runDone, runList, runRm } from "./commands/index.js";

  export interface Streams {
    readonly out: (line: string) => void;
    readonly err: (line: string) => void;
  }

  export function usageText(): string;

  export function main(
    argv: readonly string[],
    env: Readonly<Record<string, string | undefined>>,
    streams: Streams,
    clock?: () => Date,
  ): Promise<number>;
  ```
- notes: the only module allowed to depend on every other module. Order of a run: parse argv (usage errors exit 2 before any file access, BEH-021); `help` prints `usageText()` to `streams.out` and exits 0 without touching the file (CTR-005, BEH-020); otherwise resolve the path, read (a failed read is E_CANNOT_READ with that path, exit 1), run the command, on success write the returned list when it is not `null` and only then print the lines to `streams.out`, and on failure write nothing to stdout and one line to `streams.err` (ASM-009). `main` never throws: it returns 0, 1 or 2 (INV-005). `main` returns the exit code and does not call `process.exit`. src/cli.ts is the built entry: it imports `main` from `./index.js`, passes `process.argv.slice(2)`, `process.env`, streams writing to `process.stdout`/`process.stderr`, sets `process.exitCode`, and is the source of `dist/cli.js` (GA-001, IMP-001). src/cli.ts holds no logic; `usageText()` is a non-empty multi-line text listing the five command forms (the wording is not contractual, ASM-006). The root task also owns `tsconfig.build.json` (`rootDir: "src"`, `outDir: "dist"`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `strict: true`, `noEmit: false`) and the `build` script `tsc -p tsconfig.build.json` in package.json; `test` stays the foreman `vitest run` (NFR-001).

## 3. Data shapes

```ts
// M-02 src/store/index.ts
// covers: todo-cli:CTR-006, todo-cli:INV-003
export interface Task {
  readonly id: number;
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: string;
}

// M-02 src/store/index.ts
// covers: todo-cli:CTR-006, todo-cli:INV-002
export interface TaskList {
  readonly nextId: number;
  readonly tasks: readonly Task[];
}

// M-02 src/store/index.ts
// covers: todo-cli:CTR-006, todo-cli:POL-003
export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

// M-01 src/errors/index.ts
// covers: todo-cli:POL-001, todo-cli:INV-005
export type ErrorCode =
  | "E_USAGE_MISSING_ARGUMENT"
  | "E_USAGE_EMPTY_TEXT"
  | "E_USAGE_UNKNOWN_OPTION"
  | "E_USAGE_INVALID_ID"
  | "E_NO_TASK"
  | "E_CANNOT_READ";

// M-01 src/errors/index.ts
// covers: todo-cli:POL-001
export interface CliError {
  readonly code: ErrorCode;
  readonly line: string;
}

// M-03 src/args/index.ts
// covers: todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-005
export type ParsedCommand =
  | { readonly command: "help" }
  | { readonly command: "add"; readonly text: string }
  | { readonly command: "list"; readonly all: boolean }
  | { readonly command: "done"; readonly idToken: string }
  | { readonly command: "rm"; readonly idToken: string };

// M-04 src/commands/index.ts
// covers: todo-cli:CTR-001, todo-cli:INV-004
export type CommandOutcome =
  | { readonly ok: true; readonly lines: readonly string[]; readonly list: TaskList | null }
  | { readonly ok: false; readonly error: CliError };

// M-05 src/index.ts
// covers: todo-cli:IMP-001, todo-cli:GA-001
export interface Streams {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}
```

## 4. Error mapping

| error code | raising module | exit code | stderr shape |
| --- | --- | --- | --- |
| E_OK | M-05 (success path, no error) | 0 | none |
| E_USAGE_MISSING_ARGUMENT | M-03 | 2 | `usage: missing argument` |
| E_USAGE_EMPTY_TEXT | M-03 | 2 | `usage: empty text` |
| E_USAGE_UNKNOWN_OPTION | M-03 | 2 | `usage: unknown argument <token>` |
| E_USAGE_INVALID_ID | M-03 | 2 | `usage: invalid id <token>` |
| E_NO_TASK | M-04 | 1 | `error: no task #<token>` |
| E_CANNOT_READ | M-02 detects, M-05 raises | 1 | `error: cannot read <resolved path>` |

Every failure prints exactly one line on stderr, terminated by `\n`, and nothing on stdout (POL-001, ASM-009). E_USAGE_UNKNOWN_OPTION covers both an option the invoked command does not define and a command word that names no command (DD-01). E_CANNOT_READ is also used when `writeTaskList` fails, because the spec's taxonomy has no separate write-failure code (DD-06).

## 5. Process and IO boundaries

- Invocation: `node dist/cli.js <command> [args...]`; the CLI reads `process.argv.slice(2)` and nothing else (IMP-001). No stdin is ever read.
- argv grammar, in order:
  1. `argv` empty -> E_USAGE_MISSING_ARGUMENT.
  2. `argv[0] === "--help"` -> `help`; every remaining token after `--help` is ignored.
  3. `argv[0] === "add"` -> the tokens after it are the text: any token beginning with `--` -> E_USAGE_UNKNOWN_OPTION; no token -> E_USAGE_MISSING_ARGUMENT; the tokens joined with a single space and trimmed empty -> E_USAGE_EMPTY_TEXT; otherwise `add` with the joined, trimmed text (ASM-007).
  4. `argv[0] === "list"` -> `--all` sets `all` true (a repeated `--all` is still `all` true); any other token beginning with `--` -> E_USAGE_UNKNOWN_OPTION; a token not beginning with `--` is ignored (ASM-012).
  5. `argv[0] === "done"` or `"rm"` -> any token beginning with `--` -> E_USAGE_UNKNOWN_OPTION; no token -> E_USAGE_MISSING_ARGUMENT; the first token must match `^[0-9]+$` with a value at least 1, else E_USAGE_INVALID_ID; further tokens are ignored (ASM-005, ASM-012).
  6. any other `argv[0]` -> E_USAGE_UNKNOWN_OPTION (a `--` token or an unknown command word; BEH-012, ASM-004).
- Environment: `TODO_FILE`. Resolution: the value verbatim when it is set and non-empty, otherwise the relative path `./todo.json` resolved against the process working directory (CTR-007, ASM-008). The resolved string is what E_CANNOT_READ names, verbatim.
- File: UTF-8, read and written with the Node.js standard library only. Absent file = empty list with `nextId` 1; `readTaskList` never creates it. On success of a writing command the whole file is replaced by one `writeFileSync` of `JSON.stringify(list, null, 2) + "\n"` (DD-02).
- stdout: one `\n` after each printed line, zero bytes when a command prints nothing; failure paths print zero bytes to stdout.
- stderr: exactly one line plus `\n` per failure.
- Exit: 0 success, 1 store error, 2 usage error, never another value (INV-005). `main` returns the code; `src/cli.ts` assigns it to `process.exitCode` and lets the process end naturally.
- Time: `createdAt` is `new Date().toISOString()` via `formatCreatedAt`, which the root passes as the clock into `runAdd` so a test can inject a fixed clock.
- Network: none (CON-001); the only imports are `node:fs`, `node:path`, `node:url` and the product's own modules (CON-002).

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@5.6.3", "vitest@2.1.4", "@types/node@22.7.5"]
  tsconfig: { module: NodeNext, moduleResolution: NodeNext, target: ES2022, strict: true, noEmit: true }
```

## 7. Design decisions

DD-01 usage error codes and their stderr lines
- evidence: [todo-cli:POL-001, todo-cli:CTR-001, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:BEH-012]
- decision: the six codes of the taxonomy are the whole vocabulary; the four usage codes exit 2 with one `usage:` line, E_NO_TASK and E_CANNOT_READ exit 1 with one `error:` line. E_USAGE_UNKNOWN_OPTION is the code for any argument token the invoked command does not define, including a command word that names no command (`todo frobnicate`, `todo --bogus`), whose text is `usage: unknown argument <token>`. E_NO_TASK renders the typed token: `error: no task #<token>`. E_CANNOT_READ renders the resolved path: `error: cannot read <path>`. The remaining wording inside the `usage:` lines is free.
- alternatives_rejected: a new code E_USAGE_UNKNOWN_COMMAND (no approved record names it, and section 3 of the spec fixes the code set); a fixed full usage block on every usage error (only the prefix is contractual, ASM-009 and POL-001 leave the line free).
- consequence: three commands share the same usage line, tests assert prefix, exit code and the two `error:` texts only, and the planner has one home for every code.

DD-02 storage file serialization and validation
- evidence: [todo-cli:CTR-006, todo-cli:POL-003, todo-cli:INV-002]
- decision: the file is UTF-8 JSON, written as `JSON.stringify({nextId, tasks}, null, 2)` followed by one `\n`, with the tasks array kept in ascending id order. A read accepts only a root object with integer `nextId` at least 1 and a `tasks` array of objects carrying integer `id` at least 1, non-empty `text`, boolean `done` and a `createdAt` string matching `YYYY-MM-DDTHH:MM:SS.sssZ`; ids must ascend strictly. Anything else, including a JSON array, a scalar, a missing key or `{oops`, is `ok: false`, never an empty list, and the file is left untouched.
- alternatives_rejected: a root array with the next id derived from the highest stored id (a removed highest id becomes reusable, breaking INV-002); a lenient read that fills missing keys (a foreign file would be overwritten, breaking POL-003).
- consequence: a corrupt or foreign file fails every command with E_CANNOT_READ until a human removes it; the writer is a single full-file replacement, which is enough because concurrency handling is out of scope.

DD-03 createdAt through an injected clock
- evidence: [todo-cli:CTR-006, todo-cli:BEH-001, todo-cli:INV-003]
- decision: `createdAt` is `new Date().toISOString()`, the UTC millisecond form fixed by ASM-002, produced by `formatCreatedAt` in the store and passed into `runAdd` as a `() => Date` clock supplied by the root.
- alternatives_rejected: calling `new Date()` inside the command function (a test cannot observe the value deterministically); second precision (ASM-002 fixes milliseconds).
- consequence: the store owns the timestamp text, the root owns the time source, and a test can inject a fixed instant.

DD-04 in-process command execution and the built artifact
- evidence: [todo-cli:NFR-001, todo-cli:GA-001, todo-cli:IMP-001]
- decision: all command logic runs through `main(argv, env, streams, clock)` from `src/index.ts`; tests call it in process with recording streams and a temporary directory behind `TODO_FILE`, so the vitest suite needs no build and no subprocess. `src/cli.ts` is a thin process wrapper and the source of `dist/cli.js`; `tsconfig.build.json` (owned by the root module) emits `dist/` and `npm run build` runs it, which is what makes `node dist/cli.js --help` work.
- alternatives_rejected: spawning `node dist/cli.js` from every test (the suite would depend on a completed build and break `npx vitest run` on a clean tree); running TypeScript sources through Node's type stripping (the `.js` specifiers of the ESM source are not remapped).
- consequence: behavioural tests are fast and offline; the artifact obligation is checked by `npm run build` plus one `node dist/cli.js --help` smoke check.

DD-05 id tokens and text normalization
- evidence: [todo-cli:BEH-001, todo-cli:BEH-003, todo-cli:BEH-014, todo-cli:CTR-003]
- decision: an id argument is valid only when it consists of decimal digits and its value is at least 1 (`+5`, `-1`, `0`, `1.0`, ` 5` and `abc` are usage errors); the typed token is echoed verbatim in `#<token> done`, `#<token> removed` and `error: no task #<token>`, while comparison against stored ids uses its integer value. Text is the words joined with a single space and trimmed before the blank check, so `add "  buy   milk  "` stores `buy milk`.
- alternatives_rejected: accepting any numeric token and printing the canonical integer (the printed line would differ from the typed token); storing the raw argument including surrounding spaces (blank-surrounded text would reach the file).
- consequence: `done 007` prints `#007 done` for a task whose stored id is 7.

DD-06 write failures reuse E_CANNOT_READ
- evidence: [todo-cli:POL-001, todo-cli:INV-005, todo-cli:CTR-007]
- decision: the taxonomy has no code for a write that the file system rejects, so `writeTaskList` returns `ok: false` and the root reports E_CANNOT_READ, exit 1, `error: cannot read <resolved path>`.
- alternatives_rejected: a new code such as E_CANNOT_WRITE (outside the approved taxonomy); letting the exception escape (it would break the 0/1/2 exit-code invariant).
- consequence: some failures carry a message that says "read" for a write; the code set and exit classes stay exactly as the spec fixes them.

DD-07 write before print
- evidence: [todo-cli:INV-006, todo-cli:INV-007, todo-cli:BEH-009]
- decision: the root writes the returned list first and emits the stdout lines only after the write succeeded; a failing command never reaches the write, and a read-only command returns `list: null` and never calls the writer.
- alternatives_rejected: printing first and writing afterwards (a failed write would leave a success line on stdout); writing on every invocation (a failed parse or a `--no-task` error would rewrite the file).
- consequence: stdout is only produced for commands that are fully committed, and stderr never follows partial stdout.

## 8. Traceability

| spec id | module |
| --- | --- |
| todo-cli:BEH-001 | M-04 |
| todo-cli:BEH-002 | M-04 |
| todo-cli:BEH-003 | M-04 |
| todo-cli:BEH-004 | M-04 |
| todo-cli:BEH-005 | M-04 |
| todo-cli:BEH-006 | M-04 |
| todo-cli:BEH-007 | M-04 |
| todo-cli:BEH-008 | M-04 |
| todo-cli:BEH-009 | M-04 |
| todo-cli:BEH-010 | M-04 |
| todo-cli:BEH-011 | M-04 |
| todo-cli:BEH-012 | M-03 |
| todo-cli:BEH-013 | M-03 |
| todo-cli:BEH-014 | M-03 |
| todo-cli:BEH-015 | M-03 |
| todo-cli:BEH-016 | M-02 |
| todo-cli:BEH-017 | M-02 |
| todo-cli:BEH-018 | M-02 |
| todo-cli:BEH-019 | M-02 |
| todo-cli:BEH-020 | M-05 |
| todo-cli:BEH-021 | M-03 |
| todo-cli:SCN-001 | M-05 |
| todo-cli:SCN-002 | M-05 |
| todo-cli:SCN-003 | M-05 |
| todo-cli:NFR-001 | M-05 |
| todo-cli:CTR-001 | M-04 |
| todo-cli:CTR-002 | M-04 |
| todo-cli:CTR-003 | M-04 |
| todo-cli:CTR-004 | M-04 |
| todo-cli:CTR-005 | M-05 |
| todo-cli:CTR-006 | M-02 |
| todo-cli:CTR-007 | M-02 |
| todo-cli:INV-001 | M-02 |
| todo-cli:INV-002 | M-02 |
| todo-cli:INV-003 | M-02 |
| todo-cli:INV-004 | M-04 |
| todo-cli:INV-005 | M-01 |
| todo-cli:INV-006 | M-02 |
| todo-cli:INV-007 | M-02 |
| todo-cli:POL-001 | M-01 |
| todo-cli:POL-002 | M-03 |
| todo-cli:POL-003 | M-02 |
| todo-cli:CON-001 | M-05 |
| todo-cli:CON-002 | M-05 |
| todo-cli:GA-001 | M-05 |
| todo-cli:IMP-001 | M-05 |

## 9. Revisions

none
