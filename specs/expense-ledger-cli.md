# ledger — a command-line expense ledger

Build a small command-line tool called `ledger` in TypeScript that records personal expenses in a JSON file and reports on them.

## Storage

- Expenses live in a JSON file. The path comes from the environment variable `LEDGER_FILE`; when it is not set, use `./ledger.json` in the current directory.
- When the file does not exist, the ledger is empty. The first write creates it.
- Each expense has an integer `id` (starting at 1, never reused within a file), an `amount` in integer cents, a `category` (lowercase letters, digits and `-`, 1 to 20 characters), a `date` (`YYYY-MM-DD`) and an optional `note` string.

## Commands

- `ledger add <amount> <category> [--date YYYY-MM-DD] [--note <text>]` — records an expense. `<amount>` is a positive decimal with at most two fractional digits (`12`, `12.5`, `12.50`); it is stored in cents. The date defaults to today in UTC. Prints `#<id> <amount> <category> <date>` with the amount formatted with exactly two decimals.
- `ledger list [--category <category>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]` — prints one line per matching expense as `#<id> <date> <amount> <category>`, followed by ` — <note>` when a note exists, ordered by date and then id. `--from` and `--to` are inclusive. Prints nothing when nothing matches.
- `ledger summary [--month YYYY-MM]` — prints one line per category as `<category> <total>`, ordered by total descending and then category name, followed by a last line `total <total>`. With `--month`, only expenses of that month count. With no expenses it prints only `total 0.00`.
- `ledger rm <id>` — removes the expense. Prints `#<id> removed`.
- `ledger export --csv` — prints the whole ledger as CSV with the header `id,date,amount,category,note`, one row per expense ordered by id, the amount with two decimals, and the note quoted with double quotes when it contains a comma, a double quote or a newline (inner double quotes doubled).
- `ledger --help` — prints the usage text.

## Errors

- Unknown command, unknown option, missing argument, an invalid amount, category, date or month, or an invalid id → exit code 2 and a one-line message on stderr starting with `usage:`.
- Unknown expense id for `rm` → exit code 1 and `error: no expense #<id>` on stderr.
- A storage file that cannot be parsed → exit code 1 and `error: cannot read <path>` on stderr.
- Successful commands exit with 0.

## Non-goals

- No currencies, budgets, recurring expenses or editing of existing expenses.
- No concurrent access handling.

## Acceptance

The project must build with `npm run build` and its tests must pass with `npm test`. The CLI is invoked as `node dist/cli.js <command>`.
