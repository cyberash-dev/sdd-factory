# Technical design: todo-cli

## 1. Overview

`todo` is a single-process TypeScript command-line program invoked as `node dist/cli.js <command>` and installed through `npm run build`. It reads its argv once, executes exactly one of five commands (`add <text>`, `list [--all]`, `done <id>`, `rm <id>`, `--help`), and keeps every task in one JSON array in the storage file selected by `TODO_FILE` or `./todo.json`. Every success prints one result line on stdout and exits 0; every failure prints exactly one `usage:` or `error:` line on stderr and exits 1 or 2. The program performs no network access and declares no run-time dependency.

## 2. Module map

### M-01 errors
- responsibility: define the stable error codes, their exit codes and the one-line rendering of a failure, plus the shared command-result union.
- covers: [todo-cli:POL-001]
- owns: src/errors/**
- entry: src/errors/index.ts
- depends_on: []
- public interface:
  ```ts
  export type ErrorCode = "E_USAGE" | "E_NO_TASK" | "E_STORAGE";

  export interface CliError {
    readonly code: ErrorCode;
    readonly exitCode: 1 | 2;
    readonly message: string;
  }

  export type CommandResult =
    | { readonly ok: true; readonly stdout: string }
    | { readonly ok: false; readonly error: CliError };

  export function usageError(detail: string): CliError;
  export function noTaskError(id: number): CliError;
  export function storageError(path: string): CliError;
  export function formatErrorLine(error: CliError): string;
  export function isCliError(value: unknown): value is CliError;
  ```
- notes: raises no error itself; `usageError` builds message `usage: <detail>`, `noTaskError` builds `error: no task #<id>`, `storageError` builds `error: cannot read <path>`; `formatErrorLine` returns the single stderr line without a trailing newline. The module imports nothing, which keeps it a leaf of the dependency graph.

### M-02 store
- responsibility: resolve the storage path, read and validate the JSON task array, write it back, allocate the next id and stamp `createdAt`.
- covers: [todo-cli:CTR-006, todo-cli:INV-001, todo-cli:INV-002, todo-cli:INV-004, todo-cli:BEH-003, todo-cli:BEH-004, todo-cli:BEH-017, todo-cli:BEH-018, todo-cli:BEH-019]
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

  export type TaskList = readonly Task[];

  export type StoreReadResult =
    | { readonly ok: true; readonly tasks: TaskList }
    | { readonly ok: false; readonly path: string };

  export type StoreWriteResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly path: string };

  export function resolveStoragePath(env: NodeJS.ProcessEnv, cwd: string): string;
  export function readTasks(path: string): StoreReadResult;
  export function writeTasks(path: string, tasks: TaskList): StoreWriteResult;
  export function nextTaskId(tasks: TaskList): number;
  export function createTask(id: number, text: string, now: Date): Task;
  ```
- notes: `readTasks` returns an empty list for a missing file and never creates it (INV-004); a file that is not a JSON array of four-field task objects yields `{ ok: false, path }` (BEH-018). `writeTasks` creates a missing file on first write (BEH-003). `nextTaskId` returns `max(id) + 1`, or 1 for an empty list. `createTask` sets `createdAt` from `now.toISOString()`. All filesystem calls are synchronous and use UTF-8. The module imports nothing: it reports failures as result values so it stays a leaf.

### M-03 parse
- responsibility: turn `process.argv.slice(2)` into one typed command or one usage error, rejecting unknown commands, unknown flags, wrong argument counts, blank text and invalid ids before any storage access.
- covers: [todo-cli:BEH-002, todo-cli:BEH-013, todo-cli:BEH-014, todo-cli:BEH-015, todo-cli:POL-002]
- owns: src/parse/**
- entry: src/parse/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { CliError } from "../errors/index.js";

  export type ParsedCommand =
    | { readonly kind: "add"; readonly text: string }
    | { readonly kind: "list"; readonly all: boolean }
    | { readonly kind: "done"; readonly id: number }
    | { readonly kind: "rm"; readonly id: number }
    | { readonly kind: "help" };

  export function parseArgs(argv: readonly string[]): ParsedCommand | CliError;
  ```
- notes: usage errors are produced here and nowhere else; every rejected argv returns a `CliError` with code `E_USAGE`, exit code 2 and a message starting with `usage:`.

### M-04 read commands
- responsibility: execute `list` and `--help`, rendering the one-line-per-task output and the usage text.
- covers: [todo-cli:CTR-002, todo-cli:CTR-005, todo-cli:BEH-005, todo-cli:BEH-006, todo-cli:BEH-007, todo-cli:BEH-016]
- owns: src/read-commands/**
- entry: src/read-commands/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { CommandResult } from "../errors/index.js";
  import type { Task, TaskList } from "../store/index.js";

  export function runList(path: string, all: boolean): CommandResult;
  export function runHelp(): CommandResult;
  export function renderList(tasks: TaskList, all: boolean): string;
  export function usageText(): string;
  ```
- notes: `runList` reads through M-02 and maps `{ ok: false }` to `storageError(path)`; it never writes and never creates the file (BEH-017). `renderList` shows open tasks in ascending id; with `all` it shows every task in one ascending id order, completed tasks prefixed `[x] `; it returns `""` when nothing is shown (BEH-007). `usageText` contains the tokens `add`, `list`, `done`, `rm` and `--help` (BEH-016) and is rendered to stdout with exit 0.

### M-05 write commands
- responsibility: execute `add`, `done` and `rm`, including id lookup, id allocation, persistence and the success lines.
- covers: [todo-cli:CTR-001, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:BEH-001, todo-cli:BEH-008, todo-cli:BEH-009, todo-cli:BEH-010, todo-cli:BEH-011, todo-cli:BEH-012]
- owns: src/write-commands/**
- entry: src/write-commands/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { CommandResult } from "../errors/index.js";

  export function runAdd(path: string, text: string, now: Date): CommandResult;
  export function runDone(path: string, id: number): CommandResult;
  export function runRm(path: string, id: number): CommandResult;
  ```
- notes: each reads the storage file first, then acts. `runAdd` allocates the id with `nextTaskId`, stamps `createdAt` from `now`, writes, and prints `#<id> <text>`; it creates the file when absent (BEH-003). `runDone` prints `#<id> done` and leaves an already-completed task unchanged (BEH-009); `runRm` prints `#<id> removed`. A missing id yields `noTaskError(id)` with exit 1 and no write (BEH-010, BEH-012); a read or write failure yields `storageError(path)` with exit 1.

### M-06 cli (composition root)
- responsibility: process entry: parse argv, dispatch the parsed command to one command module, write the result line to stdout or the error line to stderr, and set the exit code.
- covers: [todo-cli:INV-003, todo-cli:CON-001, todo-cli:CON-002, todo-cli:CON-003, todo-cli:CON-004, todo-cli:CON-005, todo-cli:CON-006]
- owns: src/cli.ts, tsconfig.build.json, package.json scripts (build, test, typecheck)
- entry: src/cli.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05]
- public interface:
  ```ts
  import type { CommandResult } from "./errors/index.js";
  import type { ParsedCommand } from "./parse/index.js";
  import type { CliError } from "./errors/index.js";

  export function run(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): CommandResult;
  export function main(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): number;
  ```
- notes: `run` resolves the path with `resolveStoragePath(env, cwd)` and dispatches on `ParsedCommand.kind`; a `CliError` returned by `parseArgs` is folded into `{ ok: false, error }`. `main` writes `result.stdout` to stdout on success and `formatErrorLine(error)` plus one `\n` to stderr on failure, returning 0, 1 or 2, and catching any unexpected exception as `storageError(path)` so no stack trace escapes (INV-003, POL-002). When executed as the process entry it sets `process.exitCode = main(process.argv.slice(2), process.env, process.cwd())`. This module is the only one allowed to depend on all others. It owns `tsconfig.build.json` (`rootDir: "src"`, `outDir: "dist"`, `noEmit: false`, `include: ["src"]`) so `npm run build` emits `dist/cli.js`, and verifies that `package.json` carries `"type": "module"` and the `build`, `test` and `typecheck` scripts.

## 3. Data shapes

```ts
// src/store/index.ts
export interface Task {
  readonly id: number;          // positive integer, unique per file, never changed for an existing task
  readonly text: string;        // non-blank after trim, as given
  readonly done: boolean;
  readonly createdAt: string;   // UTC ISO-8601 with milliseconds and a Z suffix, from Date.prototype.toISOString
}
export type TaskList = readonly Task[];
```
covers: [todo-cli:CTR-006, todo-cli:INV-001, todo-cli:INV-002, todo-cli:BEH-004, todo-cli:ASM-003, todo-cli:ASM-007]

```ts
// src/parse/index.ts
export type ParsedCommand =
  | { readonly kind: "add"; readonly text: string }
  | { readonly kind: "list"; readonly all: boolean }
  | { readonly kind: "done"; readonly id: number }
  | { readonly kind: "rm"; readonly id: number }
  | { readonly kind: "help" };
```
covers: [todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-005, todo-cli:BEH-014, todo-cli:BEH-015, todo-cli:ASM-005, todo-cli:ASM-008]

```ts
// src/errors/index.ts
export interface CliError {
  readonly code: "E_USAGE" | "E_NO_TASK" | "E_STORAGE";
  readonly exitCode: 1 | 2;
  readonly message: string;     // one line, first token usage: or error:
}
export type CommandResult =
  | { readonly ok: true; readonly stdout: string }   // one or more lines, "\n"-terminated, "" when nothing is printed
  | { readonly ok: false; readonly error: CliError };
```
covers: [todo-cli:POL-001, todo-cli:INV-003, todo-cli:BEH-007, todo-cli:BEH-016]

```ts
// src/store/index.ts
export type StoreReadResult =
  | { readonly ok: true; readonly tasks: TaskList }
  | { readonly ok: false; readonly path: string };
```
covers: [todo-cli:BEH-017, todo-cli:BEH-018, todo-cli:CTR-006]

## 4. Error mapping

| Code | Meaning | Raising module | Exit code | stderr shape | stdout |
| --- | --- | --- | --- | --- | --- |
| `E_SUCCESS` | command succeeded | M-04 (list, help), M-05 (add, done, rm) | 0 | empty | one result line, `\n`-terminated; empty for `list` with nothing to show and for nothing else |
| `E_USAGE` | unknown command, unknown flag, missing/extra argument, blank text, invalid id | M-03 | 2 | one line `usage: <safe usage detail>` | empty |
| `E_NO_TASK` | `done` or `rm` names an id absent from the storage file | M-05 | 1 | one line `error: no task #<id>` | empty |
| `E_STORAGE` | storage file unreadable: malformed JSON, content that is not a task array, or a read/write failure | M-02 (reported by M-04 and M-05) | 1 | one line `error: cannot read <path>` | empty |

`E_SUCCESS` result lines: `add` → `#<id> <text>`; `done` → `#<id> done`; `rm` → `#<id> removed`; `list` → `#<id> <text>` per open task and `[x] #<id> <text>` per completed task with `--all`; `--help` → the usage text. covers: [todo-cli:POL-001, todo-cli:POL-002, todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-005, todo-cli:CTR-006, todo-cli:BEH-002, todo-cli:BEH-010, todo-cli:BEH-012, todo-cli:BEH-013, todo-cli:BEH-014, todo-cli:BEH-015, todo-cli:BEH-018]

## 5. Process and IO boundaries

argv grammar, `argv` being `process.argv.slice(2)`:

```
todo <command> [args]
  add <text>          exactly one positional; reject 0 or 2+; reject text that is empty or blank after trim
  list [--all]        no positional; the only accepted flag is --all; any other flag is E_USAGE
  done <id>           exactly one positional; id matches /^[1-9][0-9]*$/
  rm <id>             exactly one positional; id matches /^[1-9][0-9]*$/
  --help              no positional, no flag
  (empty argv)        E_USAGE
```

- stdin: never read.
- env: `TODO_FILE` names the storage file. Any value, including an empty string, is used verbatim as the path; when the variable is unset (`undefined`) the path is `./todo.json`.
- path resolution: a relative `TODO_FILE` value and the default `./todo.json` resolve against `process.cwd()`; the module receives `cwd` as a parameter. No parent directory is created.
- storage file: UTF-8 text containing a JSON array of task objects, written as `JSON.stringify(tasks, null, 2) + "\n"`; a missing file reads as an empty list; the file is only created by a successful `add`, `done` or `rm` write.
- stdout: UTF-8, result lines only, each terminated by `\n`; nothing on failure; `list` with nothing to show writes zero bytes.
- stderr: UTF-8, exactly one line on failure, terminated by `\n`, first token `usage:` or `error:`; nothing on success.
- exit: 0 success, 1 `E_NO_TASK` and `E_STORAGE`, 2 `E_USAGE`; any unexpected exception is caught at M-06 and reported as `E_STORAGE` with exit 1.
- no network access, no child processes, no timers, no signal handlers.
covers: [todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-005, todo-cli:CTR-006, todo-cli:INV-003, todo-cli:INV-004, todo-cli:BEH-002, todo-cli:BEH-013, todo-cli:BEH-014, todo-cli:BEH-015, todo-cli:BEH-016, todo-cli:BEH-017, todo-cli:BEH-019, todo-cli:POL-002, todo-cli:CON-002, todo-cli:CON-004, todo-cli:CON-006, todo-cli:ASM-010]

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@5.6.3", "vitest@2.1.4", "@types/node@22.9.0"]
  tsconfig: { module: NodeNext, moduleResolution: NodeNext, target: ES2022, strict: true, noEmit: true }
```

covers: [todo-cli:CON-001, todo-cli:CON-002, todo-cli:CON-003, todo-cli:CON-005]

## 7. Design decisions

### DD-01 Two-layer module graph with leaf store and leaf errors
- evidence: [todo-cli:CON-001, todo-cli:POL-001, todo-cli:CTR-006]
- decision: six modules in two layers below the root: M-01 errors, M-02 store and M-03 parse import no other module (M-03 imports only M-01); M-04 read commands and M-05 write commands import M-01 and M-02; M-06 cli imports all five. Longest chain is three modules (`errors` → `parse` → `cli`, and `errors`/`store` → command module → `cli`).
- alternatives_rejected: a single commands module (would have covered more than 16 spec IDs and one responsibility); a store that raises `CliError` directly (would place `store` on the chain `errors` → `store` → `commands` → `cli`, four modules); splitting parsing into a dependency of the command modules (same four-module chain).
- consequence: the store reports storage defects as `{ ok: false, path }` values and command modules translate them into `E_STORAGE`; the planner may merge read and write commands into one task if it needs one fewer task, but not with `parse` or `store`.

### DD-02 Error codes, exit codes and total mapping
- evidence: [todo-cli:POL-001, todo-cli:POL-002, todo-cli:CTR-001, todo-cli:CTR-006]
- decision: exactly three failure codes. `E_USAGE` exits 2 with `usage:`; `E_NO_TASK` exits 1 with `error: no task #<id>`; `E_STORAGE` exits 1 with `error: cannot read <path>`. Every write failure (for example a write permission error) is reported as `E_STORAGE` with the documented `error: cannot read <path>` prefix; no fourth code and no second `error:` wording exist.
- alternatives_rejected: a distinct `E_WRITE` code and `cannot write` wording (the approved contracts list only the three codes and fix the `cannot read` prefix); exit 3 for unexpected exceptions (violates `POL-002`).
- consequence: `storageError(path)` is the single constructor for both read and write failures, and `main` catches any unexpected exception with it.

### DD-03 Storage document shape and strict validation
- evidence: [todo-cli:CTR-006, todo-cli:INV-001, todo-cli:BEH-018, todo-cli:ASM-007, todo-cli:ASM-006]
- decision: the file is a JSON array whose items are objects with `id` (integer ≥ 1), `text` (string), `done` (boolean) and `createdAt` (string matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`). Anything else — malformed JSON, a JSON object, an empty file, a missing field, a wrong field type — is unreadable and maps to `E_STORAGE`. Extra fields on an item are ignored on read and dropped on write.
- alternatives_rejected: treating a non-array document as an empty list (silently discards user data); a `{ tasks: [...] }` wrapper (adds metadata the spec does not need).
- consequence: `readTasks` returns a single failure shape and `list` on a corrupt file never overwrites it.

### DD-04 Id allocation is max-of-present plus one
- evidence: [todo-cli:BEH-004, todo-cli:INV-002, todo-cli:ASM-002]
- decision: `nextTaskId` returns `1` for an empty list and `Math.max(...ids) + 1` otherwise; no high-water mark is persisted, so the number of a removed highest id becomes available again.
- alternatives_rejected: a persisted high-water field (needs extra file state and the spec fixes four task fields with no document metadata).
- consequence: `add` needs no extra state beyond the file; ids stay unique within the file at every write.

### DD-05 Synchronous single-writer filesystem access
- evidence: [todo-cli:CON-004, todo-cli:INV-004, todo-cli:BEH-011, todo-cli:ASM-010]
- decision: use `node:fs` synchronous calls (`existsSync`, `readFileSync`, `writeFileSync`) with UTF-8, no locking and no temp-file rename; one process handles one command and exits.
- alternatives_rejected: asynchronous fs with a promise-based CLI (adds an event-loop layer with no benefit for one command); lock files (concurrent access is out of scope).
- consequence: command modules are plain synchronous functions returning `CommandResult`, which keeps unit tests free of async plumbing; `list` and `--help` never write.

### DD-06 createdAt from an injected Date
- evidence: [todo-cli:CTR-006, todo-cli:INV-001, todo-cli:BEH-001, todo-cli:ASM-003]
- decision: `createTask(id, text, now: Date)` builds `createdAt` with `now.toISOString()`, and `runAdd(path, text, now)` takes the same `now`; M-06 passes `new Date()`.
- alternatives_rejected: calling `new Date()` inside the store (untestable format and ordering); `Date.now()` arithmetic (reimplements ISO formatting).
- consequence: the stored format is exactly `YYYY-MM-DDTHH:mm:ss.sssZ`, and tests can pin the clock through the public interface.

### DD-07 Argument grammar and validation
- evidence: [todo-cli:BEH-002, todo-cli:BEH-013, todo-cli:BEH-014, todo-cli:BEH-015, todo-cli:ASM-005, todo-cli:ASM-008]
- decision: `parseArgs` matches the first token against the five commands, rejects an empty argv, rejects any second positional for `add` rather than joining, treats blank-after-trim text as a usage error, accepts only `--all` as a flag and only on `list`, and accepts an id only when it matches `/^[1-9][0-9]*$/` (so `0`, `-1`, `1.5`, `abc`, `+1` and `01` are rejected).
- alternatives_rejected: joining multiple `add` arguments (the spec fixes one positional); `Number.isInteger(Number(x))` alone (accepts `1.0` and hex forms).
- consequence: every rejected argv is rejected before any storage read, so the storage file is untouched for all usage failures.

### DD-08 Help text and list ordering
- evidence: [todo-cli:BEH-016, todo-cli:BEH-006, todo-cli:CTR-005, todo-cli:ASM-009, todo-cli:ASM-004]
- decision: `usageText()` returns one multi-line block containing `--help`, `add <text>`, `list [--all]`, `done <id>` and `rm <id>` plus a line documenting the `usage:` and `error:` prefixes; `--help` prints it to stdout with exit 0 and never reads the storage file. `list --all` renders all tasks in one ascending-id order with `[x] ` before completed ones; plain `list` renders only open tasks in ascending-id order.
- alternatives_rejected: a fixed, contract-tested help wording (the spec fixes only the five tokens); completed tasks grouped after open ones (the `--all` example contradicts it).
- consequence: no storage read on `--help`, and one ordering rule for both list forms.

### DD-09 Build entry and emitting tsconfig
- evidence: [todo-cli:CON-006, todo-cli:CON-001, todo-cli:CON-002, todo-cli:CON-003]
- decision: the process entry is `src/cli.ts`; `tsconfig.build.json` sets `rootDir: "src"`, `outDir: "dist"`, `noEmit: false`, `include: ["src"]` and otherwise extends `tsconfig.json`, so `tsc -p tsconfig.build.json` emits `dist/cli.js`. `package.json` stays `"type": "module"` with `build` running that command, `test` running vitest and `typecheck` running `tsc --noEmit`. The default `tsconfig.json` keeps `noEmit: true` and no `rootDir`, so tests and `src` type-check together.
- alternatives_rejected: emitting from the shared `tsconfig.json` (a `rootDir` there breaks the verifier on test files); a separate `src/index.ts` entry (would emit `dist/index.js`, not the `dist/cli.js` the spec invokes).
- consequence: M-06 owns `tsconfig.build.json` and the package scripts; the acceptance path is `npm run build` then `node dist/cli.js --help`.

### DD-10 No run-time dependencies, pinned dev toolchain
- evidence: [todo-cli:CON-005, todo-cli:CON-003, todo-cli:CON-001, todo-cli:ASM-011]
- decision: `dependencies` is empty; every capability comes from the Node.js 22 standard library (`node:fs`, `node:process`, `node:path`). Dev dependencies are pinned to `typescript@5.6.3`, `vitest@2.1.4` and `@types/node@22.9.0`.
- alternatives_rejected: a CLI framework or a JSON-schema validator (both are run-time dependencies the spec forbids); floating versions (non-reproducible installs).
- consequence: lanes add no package; the product build and test path work offline from the product root.

## 8. Traceability

| Spec ID | Module |
| --- | --- |
| todo-cli:CTR-001 | M-05 |
| todo-cli:CTR-002 | M-04 |
| todo-cli:CTR-003 | M-05 |
| todo-cli:CTR-004 | M-05 |
| todo-cli:CTR-005 | M-04 |
| todo-cli:CTR-006 | M-02 |
| todo-cli:BEH-001 | M-05 |
| todo-cli:BEH-002 | M-03 |
| todo-cli:BEH-003 | M-02 |
| todo-cli:BEH-004 | M-02 |
| todo-cli:BEH-005 | M-04 |
| todo-cli:BEH-006 | M-04 |
| todo-cli:BEH-007 | M-04 |
| todo-cli:BEH-008 | M-05 |
| todo-cli:BEH-009 | M-05 |
| todo-cli:BEH-010 | M-05 |
| todo-cli:BEH-011 | M-05 |
| todo-cli:BEH-012 | M-05 |
| todo-cli:BEH-013 | M-03 |
| todo-cli:BEH-014 | M-03 |
| todo-cli:BEH-015 | M-03 |
| todo-cli:BEH-016 | M-04 |
| todo-cli:BEH-017 | M-02 |
| todo-cli:BEH-018 | M-02 |
| todo-cli:BEH-019 | M-02 |
| todo-cli:INV-001 | M-02 |
| todo-cli:INV-002 | M-02 |
| todo-cli:INV-003 | M-06 |
| todo-cli:INV-004 | M-02 |
| todo-cli:POL-001 | M-01 |
| todo-cli:POL-002 | M-03 |
| todo-cli:CON-001 | M-06 |
| todo-cli:CON-002 | M-06 |
| todo-cli:CON-003 | M-06 |
| todo-cli:CON-004 | M-06 |
| todo-cli:CON-005 | M-06 |
| todo-cli:CON-006 | M-06 |

## 9. Revisions

none
