# todo — a command-line task list

Build a small command-line tool called `todo` in TypeScript. It keeps a list of tasks in a JSON file and lets the user add, list, complete and remove tasks.

## Storage

- Tasks live in a JSON file. The path comes from the environment variable `TODO_FILE`; when it is not set, use `./todo.json` in the current directory.
- When the file does not exist, the list is empty. The first write creates it.
- Each task has an integer `id` (starting at 1, never reused within a file), a `text` string, a `done` boolean and a `createdAt` ISO-8601 timestamp.

## Commands

- `todo add <text>` — adds a task. Prints the new task as `#<id> <text>`. Empty or whitespace-only text is an error.
- `todo list [--all]` — prints one line per open task as `#<id> <text>`, ordered by id. With `--all`, also prints completed tasks with a `[x]` prefix: `[x] #<id> <text>`. Prints nothing when there are no tasks to show.
- `todo done <id>` — marks the task as done. Prints `#<id> done`. Marking an already completed task again is not an error and prints the same line.
- `todo rm <id>` — removes the task. Prints `#<id> removed`.
- `todo --help` — prints the usage text.

## Errors

- Unknown command, missing argument or invalid id (not a positive integer) → exit code 2 and a one-line message on stderr starting with `usage:`.
- Unknown task id for `done` or `rm` → exit code 1 and `error: no task #<id>` on stderr.
- A storage file that cannot be parsed → exit code 1 and `error: cannot read <path>` on stderr.
- Successful commands exit with 0.

## Non-goals

- No due dates, priorities or tags.
- No concurrent access handling.
- No interactive mode.

## Acceptance

The project must build with `npm run build` and its tests must pass with `npm test`. The CLI is invoked as `node dist/cli.js <command>`.
