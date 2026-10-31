# Verification design: expense-ledger-cli

## 1. Scope

39 blocks, in spec order:

- Behavior 18: BEH-001 to BEH-018
- Scenario 3: SCN-001 to SCN-003
- Contract 8: CTR-001 to CTR-008
- Invariant 8: INV-001 to INV-008
- Policy 2: POL-001, POL-002
- NFR 0: the spec holds no NFR record

No block, not eligible: SUR-001 (Surface), the Partition record, CON-001 to CON-006 (Constraint), Q-001 to Q-009 (Open-Q), A-001 to A-009 (ASSUMPTION), BL-001 (BrownfieldBaseline), EXT-001 (ExternalDependency), GEN-001 (GeneratedArtifact).

`spec/assumptions.md` holds no additional ASSUMPTION record. The following ASSUMPTION records of `spec/spec.md` are in force and every class below is derived with them: A-001 (an amount matches digits with an optional one or two digit fraction and is greater than zero), A-002 (an inverted --from/--to range matches nothing and exits 0), A-003 (--month accepts month numbers 01 to 12 only), A-004 (an id is digits without leading zeros and greater than zero), A-005 (any ledger schema violation is E_UNREADABLE_STORE), A-006 (a repeated option keeps its last value), A-007 (notes are stored verbatim), A-008 (export requires --csv), A-009 (an invocation without a command is a usage error).

## 2. Error oracle

| Error code | Observable signal | Source record |
| --- | --- | --- |
| E_SUCCESS | exit code 0; stderr empty; the documented stdout lines | `error_taxonomy` of CTR-001 to CTR-008, POL-001 |
| E_USAGE | exit code 2; stdout empty; stderr is exactly one line starting with `usage:` | POL-001, `error_taxonomy` of CTR-001 to CTR-005 and CTR-008, glossary `usage error` |
| E_NO_EXPENSE | exit code 1; stdout empty; stderr is exactly one line `error: no expense #<id>` | POL-001, `error_taxonomy` of CTR-004 and CTR-008, BEH-013 |
| E_UNREADABLE_STORE | exit code 1; stdout empty; stderr is exactly one line `error: cannot read <path>` | POL-001, `error_taxonomy` of CTR-001 to CTR-005, CTR-007 and CTR-008, BEH-017 |

E_SUCCESS appears in a `must_fail_with` slot only as an inverted oracle, for records whose failure scenarios are defects that carry no error code (wrong ordering, an extra blank line, an unwanted created file, a reused id). There the entry means: the class must not produce any failure code, and the named defect must be absent. Blocks using the inverted oracle: BEH-008, BEH-018, SCN-001, SCN-002, SCN-003, CTR-006, INV-001.

## 3. Blocks

### expense-ledger-cli:BEH-001

```yaml
id: expense-ledger-cli:BEH-001
template: Behavior
obligation: "`ledger add 12.5 coffee` on an absent ledger file exits 0 and leaves exactly one expense with id 1 and amount 1250 cents"
input_classes:
  - name: typical
    input: "LEDGER_FILE set to a path in an existing directory whose file does not exist; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; stdout is one line `#1 12.50 coffee <today in UTC>`; the ledger file now exists and holds exactly one expense with id 1 and amount 1250 cents"
  - name: empty
    input: "ledger file present holding an empty expense array; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; stdout `#1 12.50 coffee <today in UTC>`; the ledger file holds exactly one expense"
  - name: existing_expenses
    input: "ledger file holding expenses with ids 1 and 2; `node dist/cli.js add 0.05 tea`"
    expected: "exit 0; stdout `#3 0.05 tea <today in UTC>`; the ledger file holds three expenses"
  - name: boundary_one_fractional_digit
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; the stdout amount field is `12.50` and the stored amount is 1250 cents"
  - name: boundary_whole_amount
    input: "absent ledger file; `node dist/cli.js add 5 travel --note taxi`"
    expected: "exit 0; the stdout amount field is `5.00` and the stored amount is 500 cents"
  - name: invalid_non_numeric_amount
    input: "absent ledger file; `node dist/cli.js add abc coffee`"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: invalid_non_numeric_amount
    must_fail_with: "E_USAGE"
    must_not: "any expense in the ledger file, and any stdout line"
assertion_summary:
  - "the exit code is 0"
  - "stdout is exactly one line whose first three fields are `#1`, `12.50`, `coffee` and whose fourth field is a calendar day written YYYY-MM-DD"
  - "after the first invocation the ledger file at the LEDGER_FILE path exists"
  - "the ledger file holds a JSON array of one expense object whose id is 1, whose category is coffee and whose amount is the integer 1250"
  - "after `add abc coffee` the ledger file is still absent, so the ledger is empty"
feasibility: feasible
```

### expense-ledger-cli:BEH-002

```yaml
id: expense-ledger-cli:BEH-002
template: Behavior
obligation: "an amount that is not a positive decimal with at most two fractional digits exits 2 with one `usage:` stderr line and leaves the expense count unchanged"
input_classes:
  - name: typical
    input: "ledger with one expense (N = 1); `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; stdout `#2 12.50 coffee <today in UTC>`; the ledger holds 2 expenses"
  - name: empty
    input: "absent ledger file; `node dist/cli.js add 12.505 coffee`"
    expected: "E_USAGE; exit 2; the ledger file is still absent"
  - name: boundary_two_fractional_digits
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.50 coffee`"
    expected: "exit 0; stdout `#3 12.50 coffee <today in UTC>`; the ledger holds 3 expenses"
  - name: boundary_three_fractional_digits
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.505 coffee`"
    expected: "E_USAGE; exit 2"
  - name: invalid_non_numeric
    input: "ledger with N = 2 expenses; `node dist/cli.js add abc coffee`"
    expected: "E_USAGE; exit 2"
  - name: invalid_zero
    input: "ledger with N = 2 expenses; `node dist/cli.js add 0 coffee`"
    expected: "E_USAGE; exit 2"
  - name: invalid_negative
    input: "ledger with N = 2 expenses; `node dist/cli.js add -1 coffee`"
    expected: "E_USAGE; exit 2"
  - name: invalid_leading_plus
    input: "ledger with N = 2 expenses; `node dist/cli.js add +12 coffee`"
    expected: "E_USAGE; exit 2"
  - name: invalid_trailing_dot
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12. coffee`"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: boundary_three_fractional_digits
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_non_numeric
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_zero
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_negative
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_leading_plus
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_trailing_dot
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: empty
    must_fail_with: "E_USAGE"
    must_not: "the ledger file being created"
assertion_summary:
  - "each rejected amount leaves the exit code 2 and a single stderr line starting with `usage:`"
  - "stdout is empty for each rejected amount"
  - "the ledger file content after each rejected amount is byte-identical to its content before, and an absent file stays absent"
  - "no uncaught exception text appears on stderr"
feasibility: feasible
```

### expense-ledger-cli:BEH-003

```yaml
id: expense-ledger-cli:BEH-003
template: Behavior
obligation: "a category that is empty, longer than 20 characters or holds a character outside lowercase letters, digits and `-` exits 2 with one `usage:` stderr line and leaves the expense count unchanged"
input_classes:
  - name: typical
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 food-2`"
    expected: "exit 0; stdout `#3 12.50 food-2 <today in UTC>`; the ledger holds 3 expenses"
  - name: empty
    input: "absent ledger file; `node dist/cli.js add 12.5 Coffee`"
    expected: "E_USAGE; exit 2; the ledger file is still absent"
  - name: boundary_one_character
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 a`"
    expected: "exit 0; stdout `#3 12.50 a <today in UTC>`"
  - name: boundary_twenty_characters
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 abcdefghij0123456789`"
    expected: "exit 0; the category field of the stdout line is `abcdefghij0123456789`"
  - name: invalid_twenty_one_characters
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 abcdefghij01234567890`"
    expected: "E_USAGE; exit 2"
  - name: invalid_uppercase
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 Coffee`"
    expected: "E_USAGE; exit 2"
  - name: invalid_underscore
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 food_2`"
    expected: "E_USAGE; exit 2"
  - name: invalid_empty_positional
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5` followed by an empty category argument"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: invalid_twenty_one_characters
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_uppercase
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_underscore
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_empty_positional
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: empty
    must_fail_with: "E_USAGE"
    must_not: "the ledger file being created"
assertion_summary:
  - "each rejected category leaves the exit code 2, one stderr line starting with `usage:` and empty stdout"
  - "the ledger file content is byte-identical before and after each rejected category"
  - "the accepted 20 character category and the accepted 1 character category each appear verbatim in the stdout line and in the ledger file"
  - "no uncaught exception text appears on stderr"
feasibility: feasible
```

### expense-ledger-cli:BEH-004

```yaml
id: expense-ledger-cli:BEH-004
template: Behavior
obligation: "a --date value that is not a YYYY-MM-DD calendar day exits 2 with one `usage:` stderr line and leaves the expense count unchanged"
input_classes:
  - name: typical
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 coffee --date 2026-02-28`"
    expected: "exit 0; stdout `#3 12.50 coffee 2026-02-28`; the stored date is 2026-02-28"
  - name: empty
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee --date 2026-13-01`"
    expected: "E_USAGE; exit 2; the ledger file is still absent"
  - name: boundary_month_13
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 coffee --date 2026-13-01`"
    expected: "E_USAGE; exit 2"
  - name: boundary_day_00
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 coffee --date 2026-01-00`"
    expected: "E_USAGE; exit 2"
  - name: invalid_eight_digits
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 coffee --date 20260101`"
    expected: "E_USAGE; exit 2"
  - name: invalid_not_a_calendar_day
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 coffee --date 2026-02-30`"
    expected: "E_USAGE; exit 2"
  - name: invalid_missing_value
    input: "ledger with N = 2 expenses; `node dist/cli.js add 12.5 coffee --date` with no following value"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: boundary_month_13
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: boundary_day_00
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_eight_digits
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_not_a_calendar_day
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: invalid_missing_value
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: empty
    must_fail_with: "E_USAGE"
    must_not: "the ledger file being created"
assertion_summary:
  - "each rejected --date value leaves the exit code 2, one stderr line starting with `usage:` and empty stdout"
  - "the ledger file content is byte-identical before and after each rejected --date value"
  - "the accepted value 2026-02-28 appears verbatim as the date field of the stdout line and in the stored expense"
  - "no uncaught exception text appears on stderr"
feasibility: feasible
```

### expense-ledger-cli:BEH-005

```yaml
id: expense-ledger-cli:BEH-005
template: Behavior
obligation: "without --date the stored date is the current UTC calendar day"
input_classes:
  - name: typical
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee` with the system clock at an arbitrary instant"
    expected: "exit 0; the date field of the stdout line equals the UTC calendar day of that instant"
  - name: empty
    input: "ledger file present holding an empty expense array; `node dist/cli.js add 0.05 tea`"
    expected: "exit 0; the stored date equals the UTC calendar day of the invocation instant"
  - name: boundary_near_utc_day_boundary
    input: "an invocation started within the last seconds before 00:00 UTC and another started within the first seconds after 00:00 UTC"
    expected: "each invocation prints and stores the UTC day that is current at its own instant"
  - name: boundary_explicit_date_given
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee --date 2026-02-28`"
    expected: "exit 0; the date field is 2026-02-28 and not the current UTC day"
  - name: invalid_zero_amount
    input: "absent ledger file; `node dist/cli.js add 0 coffee`"
    expected: "E_USAGE; exit 2; no expense stored"
negative_oracle:
  - input_class: invalid_zero_amount
    must_fail_with: "E_USAGE"
    must_not: "a stored expense and any stdout line"
assertion_summary:
  - "the date field of the stdout line is a YYYY-MM-DD day equal to the UTC day read from the system clock at the time of the invocation"
  - "the stored date of the expense equals the same UTC day"
  - "with an explicit --date the printed and stored date is that value, unchanged by the clock"
  - "the default date is never a value that differs from the UTC day by exactly one day because of a local time zone offset"
feasibility: infeasible_candidate
infeasibility_reason: "the predicate reads the uncontrolled system clock and the record's own boundary class requires invocations on both sides of a UTC day boundary, which a deterministic offline test cannot produce"
```

### expense-ledger-cli:BEH-006

```yaml
id: expense-ledger-cli:BEH-006
template: Behavior
obligation: "list emits one line per expense as `#<id> <date> <amount> <category>` with the suffix ` — <note>` when the expense has a note, ordered by date ascending then id ascending"
input_classes:
  - name: typical
    input: "ledger holding id 1 (2026-02-01, 12.50, food), id 2 (2026-01-31, 5.00, travel, note taxi), id 3 (2026-01-31, 1.00, food); `node dist/cli.js list`"
    expected: "exit 0; stdout lines in this order: `#2 2026-01-31 5.00 travel — taxi`, `#3 2026-01-31 1.00 food`, `#1 2026-02-01 12.50 food`"
  - name: empty
    input: "absent ledger file; `node dist/cli.js list`"
    expected: "exit 0; stdout has zero bytes"
  - name: boundary_same_date
    input: "ledger holding id 4 and id 2 both dated 2026-01-31; `node dist/cli.js list`"
    expected: "exit 0; the line for id 2 precedes the line for id 4"
  - name: boundary_note_suffix
    input: "ledger holding id 1 without a note and id 2 with the note taxi; `node dist/cli.js list`"
    expected: "exit 0; the line for id 1 ends after its category with no trailing separator, the line for id 2 ends with ` — taxi`"
  - name: invalid_missing_option_value
    input: "ledger holding expenses; `node dist/cli.js list --category` with no following value"
    expected: "E_USAGE; exit 2; no stdout line"
negative_oracle:
  - input_class: invalid_missing_option_value
    must_fail_with: "E_USAGE"
    must_not: "any stdout line"
assertion_summary:
  - "stdout holds exactly one line per expense, each matching the field order id, date, amount, category"
  - "the sequence of dates in stdout is non-decreasing and, within one date, the ids are ascending"
  - "the ` — ` suffix appears on exactly the lines of expenses that have a note"
  - "each amount field carries exactly two decimals and each date field is a YYYY-MM-DD day"
feasibility: feasible
```

### expense-ledger-cli:BEH-007

```yaml
id: expense-ledger-cli:BEH-007
template: Behavior
obligation: "list returns exactly the expenses matching --category, --from and --to with both bounds inclusive and no expense outside them"
input_classes:
  - name: typical
    input: "ledger holding id 1 (2026-01-01, food), id 2 (2026-01-31, food), id 3 (2026-02-01, food), id 4 (2026-01-15, travel); `node dist/cli.js list --category food --from 2026-01-01 --to 2026-01-31`"
    expected: "exit 0; stdout holds the line for id 1 then the line for id 2 and nothing else"
  - name: empty
    input: "absent ledger file; `node dist/cli.js list --category food --from 2026-01-01 --to 2026-01-31`"
    expected: "exit 0; stdout has zero bytes"
  - name: boundary_on_from
    input: "ledger holding id 1 dated 2026-01-01; `node dist/cli.js list --from 2026-01-01 --to 2026-01-31`"
    expected: "exit 0; the line for id 1 is printed"
  - name: boundary_on_to
    input: "ledger holding id 2 dated 2026-01-31; `node dist/cli.js list --from 2026-01-01 --to 2026-01-31`"
    expected: "exit 0; the line for id 2 is printed"
  - name: boundary_one_day_outside
    input: "ledger holding id 5 dated 2025-12-31 and id 6 dated 2026-02-01; `node dist/cli.js list --from 2026-01-01 --to 2026-01-31`"
    expected: "exit 0; no line for id 5 and no line for id 6"
  - name: boundary_inverted_range
    input: "ledger holding id 1 dated 2026-01-01; `node dist/cli.js list --from 2026-02-01 --to 2026-01-01`"
    expected: "exit 0; stdout has zero bytes"
  - name: unmatched_category
    input: "ledger holding only travel expenses; `node dist/cli.js list --category supplies --from 2026-01-01 --to 2026-01-31`"
    expected: "exit 0; stdout has zero bytes"
  - name: duplicate_option
    input: "ledger holding a food and a travel expense; `node dist/cli.js list --category travel --category food`"
    expected: "exit 0; only the food expense line is printed"
  - name: invalid_to_value
    input: "ledger holding expenses; `node dist/cli.js list --from 2026-01-01 --to 2026-31-01`"
    expected: "E_USAGE; exit 2; no stdout line"
negative_oracle:
  - input_class: invalid_to_value
    must_fail_with: "E_USAGE"
    must_not: "any stdout line"
assertion_summary:
  - "the printed ids are exactly the ids satisfying category and both bounds, with both boundary days included"
  - "no printed id belongs to an expense dated before --from or after --to, or to another category"
  - "an inverted range prints zero stdout bytes and exits 0"
  - "the exit code is 0 for every accepted invocation and stderr is empty"
feasibility: feasible
```

### expense-ledger-cli:BEH-008

```yaml
id: expense-ledger-cli:BEH-008
template: Behavior
obligation: "a filter that matches nothing exits 0 and writes no stdout bytes"
input_classes:
  - name: typical
    input: "ledger holding one travel expense; `node dist/cli.js list --category food`"
    expected: "exit 0; stdout has zero bytes, not even a blank line"
  - name: empty
    input: "absent ledger file; `node dist/cli.js list --category food`"
    expected: "exit 0; stdout has zero bytes"
  - name: boundary_matching
    input: "ledger holding one travel expense; `node dist/cli.js list --category travel`"
    expected: "exit 0; stdout is exactly one line for that expense"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_SUCCESS"
    must_not: "any stdout byte including a blank line, and any non-zero exit code"
  - input_class: empty
    must_fail_with: "E_SUCCESS"
    must_not: "any stdout byte including a blank line, and any non-zero exit code"
assertion_summary:
  - "for a filter that matches nothing the stdout byte count is exactly 0"
  - "the exit code is 0 and stderr is empty"
  - "no line break of any kind is written to stdout when nothing matches"
feasibility: feasible
```

### expense-ledger-cli:BEH-009

```yaml
id: expense-ledger-cli:BEH-009
template: Behavior
obligation: "summary prints one line per category ordered by total descending then category name, followed by the total line rendered with two decimals"
input_classes:
  - name: typical
    input: "ledger with food expenses of 10.00 and 20.00 cents-total 3000 and travel expenses totalling 1250; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `food 30.00`, `travel 12.50`, `total 42.50` in that order"
  - name: empty
    input: "ledger file present holding an empty expense array; `node dist/cli.js summary`"
    expected: "exit 0; stdout is the single line `total 0.00`"
  - name: boundary_equal_totals
    input: "ledger with food totalling 2500 and home totalling 2500; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `food 25.00`, `home 25.00`, `total 50.00` in that order"
  - name: boundary_single_category
    input: "ledger holding one food expense of 10.00; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `food 10.00`, `total 10.00`"
  - name: boundary_total_order
    input: "ledger with food totalling 1250 and travel totalling 3000; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `travel 30.00`, `food 12.50`, `total 42.50` in that order"
  - name: invalid_month
    input: "ledger holding expenses; `node dist/cli.js summary --month 2026-13`"
    expected: "E_USAGE; exit 2; no stdout line"
negative_oracle:
  - input_class: invalid_month
    must_fail_with: "E_USAGE"
    must_not: "any stdout line, including a total line"
assertion_summary:
  - "the last stdout line is always `total <sum>` and appears exactly once"
  - "every category line has the form `<category> <total>` with the total carrying exactly two decimals"
  - "category lines are non-increasing in total and alphabetical among equal totals"
  - "the sum on the total line equals the sum of the category totals on the preceding lines"
feasibility: feasible
```

### expense-ledger-cli:BEH-010

```yaml
id: expense-ledger-cli:BEH-010
template: Behavior
obligation: "summary --month counts only expenses whose date lies in that calendar month"
input_classes:
  - name: typical
    input: "ledger with a food expense dated 2026-02-10 of 12.50 and a travel expense dated 2026-03-01 of 5.00; `node dist/cli.js summary --month 2026-02`"
    expected: "exit 0; stdout is `food 12.50`, `total 12.50`"
  - name: empty
    input: "absent ledger file; `node dist/cli.js summary --month 2026-02`"
    expected: "exit 0; stdout is `total 0.00`"
  - name: boundary_first_day
    input: "ledger with a food expense dated 2026-02-01; `node dist/cli.js summary --month 2026-02`"
    expected: "exit 0; stdout is `food <amount>`, `total <amount>` counting that expense"
  - name: boundary_last_day
    input: "ledger with a food expense dated 2026-02-28; `node dist/cli.js summary --month 2026-02`"
    expected: "exit 0; the total line counts that expense"
  - name: boundary_neighbouring_month
    input: "ledger with expenses dated 2026-01-31 and 2026-03-01; `node dist/cli.js summary --month 2026-02`"
    expected: "exit 0; stdout is the single line `total 0.00`"
  - name: invalid_month_00
    input: "ledger with expenses; `node dist/cli.js summary --month 2026-00`"
    expected: "E_USAGE; exit 2; no stdout line"
negative_oracle:
  - input_class: invalid_month_00
    must_fail_with: "E_USAGE"
    must_not: "any stdout line, including a total line"
  - input_class: boundary_neighbouring_month
    must_fail_with: "E_SUCCESS"
    must_not: "any category line for an expense outside the requested month, and any total other than 0.00"
assertion_summary:
  - "the total line equals the sum of the amounts dated inside the requested month only"
  - "no category line appears for a category whose only expenses lie outside the month"
  - "an expense on the first or the last day of the month is counted"
  - "the exit code is 0 for every accepted invocation and stderr is empty"
feasibility: feasible
```

### expense-ledger-cli:BEH-011

```yaml
id: expense-ledger-cli:BEH-011
template: Behavior
obligation: "summary on an empty ledger prints exactly the single line `total 0.00`"
input_classes:
  - name: typical_absent_file
    input: "absent ledger file; `node dist/cli.js summary`"
    expected: "exit 0; stdout is the single line `total 0.00`"
  - name: empty_array
    input: "ledger file present holding an empty expense array; `node dist/cli.js summary`"
    expected: "exit 0; stdout is the single line `total 0.00`"
  - name: boundary_month_filter
    input: "absent ledger file; `node dist/cli.js summary --month 2026-02`"
    expected: "exit 0; stdout is the single line `total 0.00`"
  - name: invalid_month_13
    input: "absent ledger file; `node dist/cli.js summary --month 2026-13`"
    expected: "E_USAGE; exit 2; no stdout line"
negative_oracle:
  - input_class: invalid_month_13
    must_fail_with: "E_USAGE"
    must_not: "any stdout line, including a total line"
assertion_summary:
  - "stdout is exactly one line, `total 0.00`, with no preceding category line"
  - "the exit code is 0 and stderr is empty for the empty ledger"
  - "the absent ledger file is still absent after the invocation"
feasibility: feasible
```

### expense-ledger-cli:BEH-012

```yaml
id: expense-ledger-cli:BEH-012
template: Behavior
obligation: "rm of an existing id removes exactly that expense, prints `#<id> removed` and leaves every other expense in place"
input_classes:
  - name: typical
    input: "ledger holding expenses with ids 1 and 2; `node dist/cli.js rm 1`"
    expected: "exit 0; stdout is `#1 removed`; the ledger holds only the expense with id 2"
  - name: empty
    input: "absent ledger file; `node dist/cli.js rm 1`"
    expected: "E_NO_EXPENSE; exit 1; the ledger file is still absent"
  - name: boundary_first_expense
    input: "ledger holding ids 1, 2, 3; `node dist/cli.js rm 1`"
    expected: "exit 0; stdout `#1 removed`; ids 2 and 3 remain"
  - name: boundary_last_expense
    input: "ledger holding ids 1, 2, 3; `node dist/cli.js rm 3`"
    expected: "exit 0; stdout `#3 removed`; ids 1 and 2 remain"
  - name: invalid_non_numeric_id
    input: "ledger holding ids 1 and 2; `node dist/cli.js rm one`"
    expected: "E_USAGE; exit 2"
  - name: invalid_zero_id
    input: "ledger holding ids 1 and 2; `node dist/cli.js rm 0`"
    expected: "E_USAGE; exit 2"
  - name: invalid_leading_zero_id
    input: "ledger holding ids 1 and 2; `node dist/cli.js rm 007`"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: invalid_non_numeric_id
    must_fail_with: "E_USAGE"
    must_not: "a change to the ledger file and any stdout line"
  - input_class: invalid_zero_id
    must_fail_with: "E_USAGE"
    must_not: "a change to the ledger file and any stdout line"
  - input_class: invalid_leading_zero_id
    must_fail_with: "E_USAGE"
    must_not: "a change to the ledger file and any stdout line"
  - input_class: empty
    must_fail_with: "E_NO_EXPENSE"
    must_not: "the ledger file being created and any stdout line"
assertion_summary:
  - "after a successful rm the ledger file holds exactly the previous expenses minus the one with the named id"
  - "the remaining expenses keep their ids, amounts, categories, dates and notes byte-identical"
  - "stdout is exactly `#<id> removed` and stderr is empty"
  - "a rejected id leaves the ledger file content byte-identical"
feasibility: feasible
```

### expense-ledger-cli:BEH-013

```yaml
id: expense-ledger-cli:BEH-013
template: Behavior
obligation: "an id that names no expense exits 1 with `error: no expense #<id>` on stderr, empty stdout and an unchanged ledger"
input_classes:
  - name: typical
    input: "ledger holding only the expense with id 1; `node dist/cli.js rm 7`"
    expected: "exit 1; stderr is `error: no expense #7`; stdout empty; the ledger file content is unchanged"
  - name: empty
    input: "absent ledger file; `node dist/cli.js rm 1`"
    expected: "exit 1; stderr is `error: no expense #1`; stdout empty; the ledger file is still absent"
  - name: boundary_above_highest_id
    input: "ledger holding ids 1, 2, 3; `node dist/cli.js rm 4`"
    expected: "exit 1; stderr is `error: no expense #4`"
  - name: boundary_removed_id
    input: "ledger holding ids 1 and 2; `rm 2` succeeds, then `node dist/cli.js rm 2` again"
    expected: "the second invocation exits 1 with stderr `error: no expense #2` and stdout empty"
  - name: invalid_non_numeric_id
    input: "ledger holding the expense with id 1; `node dist/cli.js rm one`"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_NO_EXPENSE"
    must_not: "any stdout byte, exit code 2, and any rewrite of the ledger file"
  - input_class: empty
    must_fail_with: "E_NO_EXPENSE"
    must_not: "the ledger file being created and any stdout line"
  - input_class: boundary_removed_id
    must_fail_with: "E_NO_EXPENSE"
    must_not: "exit code 0 and the `#2 removed` confirmation"
  - input_class: invalid_non_numeric_id
    must_fail_with: "E_USAGE"
    must_not: "the `error: no expense` message and exit code 1"
assertion_summary:
  - "stderr is exactly one line equal to `error: no expense #<id>` with the requested id"
  - "stdout has zero bytes and the exit code is 1"
  - "the ledger file bytes after the invocation equal the bytes before it, and an absent file stays absent"
  - "a non-numeric id produces the `usage:` prefix with exit code 2 instead of this message"
feasibility: feasible
```

### expense-ledger-cli:BEH-014

```yaml
id: expense-ledger-cli:BEH-014
template: Behavior
obligation: "export --csv prints the header `id,date,amount,category,note` followed by one correctly quoted row per expense ordered by id"
input_classes:
  - name: typical
    input: "ledger holding id 1 (2026-01-05, 12.50, food, note `lunch, with team`), id 2 (2026-01-03, 5.00, travel, note `the \"big\" one`), id 3 (2026-01-04, 1.00, food, no note); `node dist/cli.js export --csv`"
    expected: "exit 0; stdout lines in this order: `id,date,amount,category,note`, `1,2026-01-05,12.50,food,\"lunch, with team\"`, `2,2026-01-03,5.00,travel,\"the \"\"big\"\" one\"`, `3,2026-01-04,1.00,food,`"
  - name: empty
    input: "absent ledger file; `node dist/cli.js export --csv`"
    expected: "exit 0; stdout is the single line `id,date,amount,category,note`"
  - name: boundary_note_comma
    input: "ledger holding one expense with the note `lunch, with team`; `node dist/cli.js export --csv`"
    expected: "exit 0; the note field is wrapped in double quotes and the comma stays inside the quoted field"
  - name: boundary_note_quote
    input: "ledger holding one expense with the note `the \"big\" one`; `node dist/cli.js export --csv`"
    expected: "exit 0; the note field is `\"the \"\"big\"\" one\"`"
  - name: boundary_note_newline
    input: "ledger holding one expense whose note is the text `first` then a line break then `second`; `node dist/cli.js export --csv`"
    expected: "exit 0; the note field is wrapped in double quotes and the line break stays inside the quoted field"
  - name: boundary_no_note
    input: "ledger holding one expense without a note; `node dist/cli.js export --csv`"
    expected: "exit 0; the row ends with an empty field after the last comma"
  - name: boundary_date_order
    input: "ledger holding id 4 dated 2026-01-01 and id 5 dated 2025-12-01; `node dist/cli.js export --csv`"
    expected: "exit 0; the row for id 4 precedes the row for id 5"
  - name: invalid_missing_csv_flag
    input: "ledger holding expenses; `node dist/cli.js export`"
    expected: "E_USAGE; exit 2; no CSV on stdout"
negative_oracle:
  - input_class: invalid_missing_csv_flag
    must_fail_with: "E_USAGE"
    must_not: "the header line or any row on stdout"
assertion_summary:
  - "the first stdout line is exactly `id,date,amount,category,note`"
  - "each row has five fields and the id field is an integer"
  - "the id values of the rows are strictly increasing from the second line down"
  - "an amount field carries exactly two decimals and a date field is a YYYY-MM-DD day"
  - "a note holding a comma, a double quote or a line break appears inside one double-quoted field with inner double quotes doubled"
  - "a note-free row has an empty fifth field and no trailing space"
feasibility: feasible
```

### expense-ledger-cli:BEH-015

```yaml
id: expense-ledger-cli:BEH-015
template: Behavior
obligation: "`ledger --help` exits 0 and prints a usage text that names the add, list, summary, rm and export commands and the --help option"
input_classes:
  - name: typical_absent_file
    input: "absent ledger file; `node dist/cli.js --help`"
    expected: "exit 0; stdout holds a usage text containing `add`, `list`, `summary`, `rm`, `export` and `--help`; the ledger file is still absent"
  - name: present_file
    input: "ledger file holding two expenses; `node dist/cli.js --help`"
    expected: "exit 0; the same usage text; the ledger file content is byte-identical"
  - name: invalid_unknown_option
    input: "`node dist/cli.js --verbose`"
    expected: "E_USAGE; exit 2; nothing written to stdout"
negative_oracle:
  - input_class: invalid_unknown_option
    must_fail_with: "E_USAGE"
    must_not: "any stdout byte, including the usage text"
assertion_summary:
  - "stdout contains each of the strings `add`, `list`, `summary`, `rm`, `export` and `--help`"
  - "the exit code is 0 and stderr is empty"
  - "the ledger file is neither created nor modified by --help"
feasibility: feasible
```

### expense-ledger-cli:BEH-016

```yaml
id: expense-ledger-cli:BEH-016
template: Behavior
obligation: "an unknown command, an unknown option or a missing required value exits 2 with exactly one `usage:` stderr line and empty stdout"
input_classes:
  - name: typical_unknown_command
    input: "`node dist/cli.js frobnicate`"
    expected: "exit 2; stdout empty; stderr is exactly one line starting with `usage:`"
  - name: empty_no_command
    input: "`node dist/cli.js` with no command and no option"
    expected: "exit 2; stdout empty; stderr is exactly one line starting with `usage:`"
  - name: invalid_unknown_option
    input: "`node dist/cli.js list --verbose` against a ledger holding one expense"
    expected: "exit 2; stdout empty; stderr is exactly one line starting with `usage:`"
  - name: invalid_missing_positional
    input: "`node dist/cli.js add 12.5` with no category"
    expected: "exit 2; stdout empty; stderr is exactly one line starting with `usage:`"
negative_oracle:
  - input_class: typical_unknown_command
    must_fail_with: "E_USAGE"
    must_not: "exit code 1, any stdout byte and a second stderr line"
  - input_class: empty_no_command
    must_fail_with: "E_USAGE"
    must_not: "exit code 0, the usage text on stdout, and a second stderr line"
  - input_class: invalid_unknown_option
    must_fail_with: "E_USAGE"
    must_not: "the expense lines on stdout and exit code 1"
  - input_class: invalid_missing_positional
    must_fail_with: "E_USAGE"
    must_not: "a stored expense, any stdout byte and exit code 1"
assertion_summary:
  - "each invocation exits 2 with stdout byte count 0"
  - "stderr is exactly one line whose first six characters are `usage:` and which contains no line break"
  - "stderr holds no stack trace and no `error:` prefixed line"
feasibility: feasible
```

### expense-ledger-cli:BEH-017

```yaml
id: expense-ledger-cli:BEH-017
template: Behavior
obligation: "a ledger file that is not a JSON document of the ledger schema exits 1 with `error: cannot read <path>` on stderr and empty stdout"
input_classes:
  - name: typical_truncated
    input: "ledger file whose bytes are the truncated text `[{\"id\":1,`; `node dist/cli.js list`"
    expected: "exit 1; stderr is `error: cannot read <path>` with the LEDGER_FILE path; stdout empty"
  - name: empty_file
    input: "ledger file of zero bytes; `node dist/cli.js list`"
    expected: "exit 1; stderr is `error: cannot read <path>`; stdout empty"
  - name: boundary_not_an_array
    input: "ledger file whose bytes are `{\"expenses\":[]}`; `node dist/cli.js list`"
    expected: "exit 1; stderr is `error: cannot read <path>`; stdout empty"
  - name: boundary_schema_violation
    input: "ledger file whose bytes are `[{\"id\":1,\"amount\":\"12.50\",\"category\":\"food\",\"date\":\"2026-01-01\"}]`; `node dist/cli.js list`"
    expected: "exit 1; stderr is `error: cannot read <path>`; stdout empty"
  - name: boundary_wellformed
    input: "ledger file holding one valid expense; `node dist/cli.js list`"
    expected: "exit 0; one expense line on stdout"
negative_oracle:
  - input_class: typical_truncated
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte, exit code 0, and any uncaught exception trace on stderr"
  - input_class: empty_file
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte and exit code 0"
  - input_class: boundary_not_an_array
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte and exit code 0"
  - input_class: boundary_schema_violation
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte and any partial expense line"
assertion_summary:
  - "stderr is exactly one line equal to `error: cannot read <path>` with the ledger path substituted"
  - "stdout has zero bytes and the exit code is 1 for every malformed file"
  - "stderr carries no stack trace and no line other than the single diagnostic"
  - "the ledger file bytes are unchanged by the failed read"
feasibility: feasible
```

### expense-ledger-cli:BEH-018

```yaml
id: expense-ledger-cli:BEH-018
template: Behavior
obligation: "the first add creates the ledger file at the LEDGER_FILE path, and a read command against a missing file never creates it"
input_classes:
  - name: typical_first_add
    input: "LEDGER_FILE set to <dir>/ledger.json where the file does not exist; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; the file <dir>/ledger.json now exists and holds one expense"
  - name: empty_read_absent
    input: "LEDGER_FILE set to <dir>/ledger.json where the file does not exist; `node dist/cli.js list`"
    expected: "exit 0; stdout empty; <dir>/ledger.json is still absent"
  - name: boundary_ledger_file_env
    input: "LEDGER_FILE set to <dir>/sub/ledger.json in an existing directory; `node dist/cli.js add 5 travel`"
    expected: "exit 0; the expense is written to <dir>/sub/ledger.json and no file appears at ./ledger.json"
  - name: boundary_default_path
    input: "LEDGER_FILE unset, current working directory <dir>; `node dist/cli.js add 5 travel`"
    expected: "exit 0; <dir>/ledger.json exists and holds one expense"
negative_oracle:
  - input_class: empty_read_absent
    must_fail_with: "E_SUCCESS"
    must_not: "the ledger file existing after the invocation, any stdout byte and any `error:` line"
assertion_summary:
  - "after the first add the ledger file exists at the LEDGER_FILE path and parses as a JSON array of one expense"
  - "after a read command against a missing file the file is still absent and the exit code is 0"
  - "with LEDGER_FILE set no file is created at ./ledger.json, and with LEDGER_FILE unset the file appears at ./ledger.json relative to the working directory"
feasibility: feasible
```

### expense-ledger-cli:SCN-001

```yaml
id: expense-ledger-cli:SCN-001
template: Scenario
obligation: "the add, add, list, summary, export and rm sequence produces the documented lines and leaves exactly one expense"
input_classes:
  - name: typical
    input: "absent ledger file; the six invocations of the sequence run in order in one working directory"
    expected: "every step exits 0 and prints the lines of observable_sequence; after the last step the ledger holds only the expense with id 2"
  - name: boundary_single_expense_ledger
    input: "the same sequence run against a directory where only the first two add steps are executed"
    expected: "each add exits 0 and prints `#1 12.50 food <today in UTC>` then `#2 5.00 travel <today in UTC>`"
  - name: boundary_two_categories
    input: "the same sequence run against a directory already holding one food expense dated 2026-01-10 with id 1"
    expected: "the add steps print ids 2 and 3, the summary lists food before travel by total, and the rm step removes id 2"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_SUCCESS"
    must_not: "a stale ledger at any step, and any row for expense 1 after the rm step"
assertion_summary:
  - "each step exits 0 and each stdout line matches the line named for that step in observable_sequence"
  - "the list step prints both expenses in date then id order with the ` — taxi` suffix on expense 2 only"
  - "the export step prints the header and two rows ordered by id"
  - "after the rm step the ledger holds exactly one expense, the one with id 2, and the export of that state shows no row for id 1"
feasibility: feasible
observable_sequence:
  - "`node dist/cli.js add 12.50 food` → exit 0, stdout `#1 12.50 food <today in UTC>`, and the ledger file now exists"
  - "`node dist/cli.js add 5 travel --note taxi` → exit 0, stdout `#2 5.00 travel <today in UTC>`"
  - "`node dist/cli.js list` → exit 0, stdout `#1 <date> 12.50 food` then `#2 <date> 5.00 travel — taxi`"
  - "`node dist/cli.js summary` → exit 0, stdout `food 12.50`, `travel 5.00`, `total 17.50`"
  - "`node dist/cli.js export --csv` → exit 0, stdout `id,date,amount,category,note` then the row for id 1 and the row for id 2 in that order"
  - "`node dist/cli.js rm 1` → exit 0, stdout `#1 removed`, and the ledger holds only the expense with id 2"
  - "`node dist/cli.js export --csv` after the rm → exit 0, stdout holds the header and the row for id 2 only"
```

### expense-ledger-cli:SCN-002

```yaml
id: expense-ledger-cli:SCN-002
template: Scenario
obligation: "after removing the highest id the next add receives an id greater than every id already used in the ledger file"
input_classes:
  - name: typical
    input: "ledger holding ids 1 and 2; `node dist/cli.js rm 2` then `node dist/cli.js add 5 travel`"
    expected: "the add prints `#3 5.00 travel <today in UTC>` and the list shows ids 1 and 3"
  - name: boundary_remove_middle_id
    input: "ledger holding ids 1, 2 and 3; `node dist/cli.js rm 2` then `node dist/cli.js add 5 travel`"
    expected: "the add prints an id higher than 3 and the list shows that id alongside 1 and 3"
  - name: boundary_add_twice_after_removal
    input: "ledger holding ids 1, 2 and 3; `rm 3`, then `add 5 travel`, then `add 1 food`"
    expected: "the two adds print ids 4 and 5 in that order"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_SUCCESS"
    must_not: "the id 2 appearing again in stdout or in the ledger file after the removal"
  - input_class: boundary_remove_middle_id
    must_fail_with: "E_SUCCESS"
    must_not: "the id 2 appearing again in stdout or in the ledger file after the removal"
assertion_summary:
  - "the id printed by the add after the removal is greater than every id that the ledger file ever held"
  - "`rm 2` prints `#2 removed` and the following list shows no expense with id 2"
  - "the ledger holds exactly one expense per surviving id, with no duplicate id"
feasibility: feasible
observable_sequence:
  - "`node dist/cli.js rm 2` → exit 0, stdout `#2 removed`"
  - "`node dist/cli.js add 5 travel` → exit 0, stdout `#3 5.00 travel <today in UTC>`"
  - "`node dist/cli.js list` → exit 0, stdout shows the expense with id 1 and the expense with id 3"
```

### expense-ledger-cli:SCN-003

```yaml
id: expense-ledger-cli:SCN-003
template: Scenario
obligation: "read-only commands on an absent ledger file exit 0 and never create the file"
input_classes:
  - name: typical_absent_file
    input: "absent ledger file; `node dist/cli.js list`, then `node dist/cli.js summary`, then `node dist/cli.js export --csv`"
    expected: "each command exits 0 with the stdout of observable_sequence, and the ledger file is still absent"
  - name: boundary_ledger_file_in_existing_directory
    input: "LEDGER_FILE set to <dir>/ledger.json where the file does not exist; the same three invocations"
    expected: "each command exits 0 with the same stdout, and <dir>/ledger.json is still absent"
negative_oracle:
  - input_class: typical_absent_file
    must_fail_with: "E_SUCCESS"
    must_not: "the ledger file existing afterwards, any blank stdout line and any `error:` line"
  - input_class: boundary_ledger_file_in_existing_directory
    must_fail_with: "E_SUCCESS"
    must_not: "the ledger file existing afterwards and any `error:` line"
assertion_summary:
  - "each of the three commands exits 0 with stderr empty"
  - "the list command writes zero stdout bytes"
  - "the summary command writes exactly `total 0.00` followed by one line break"
  - "the export command writes exactly the header line `id,date,amount,category,note`"
  - "the ledger path is still absent after all three commands"
feasibility: feasible
observable_sequence:
  - "`node dist/cli.js list` → exit 0, stdout has zero bytes"
  - "`node dist/cli.js summary` → exit 0, stdout `total 0.00`"
  - "`node dist/cli.js export --csv` → exit 0, stdout is the single line `id,date,amount,category,note`"
  - "a directory listing of the ledger directory → the ledger file is still absent"
```

### expense-ledger-cli:CTR-001

```yaml
id: expense-ledger-cli:CTR-001
template: Contract
obligation: "add stores the amount in integer cents, assigns an id greater than every id already used in the file and prints `#<id> <amount> <category> <date>`"
input_classes:
  - name: typical_empty_ledger
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; stdout `#1 12.50 coffee <today in UTC>`; the stored amount is 1250 cents"
  - name: existing_expenses
    input: "ledger holding ids 1, 2 and 3; `node dist/cli.js add 1 food`"
    expected: "exit 0; stdout begins with `#4 1.00 food`"
  - name: boundary_one_decimal
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; stdout amount field is `12.50` and the stored amount is 1250"
  - name: boundary_explicit_date
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee --date 2026-02-28`"
    expected: "exit 0; the date field of stdout and of the stored expense is 2026-02-28"
  - name: boundary_default_date
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; the date field is a YYYY-MM-DD day equal to the UTC day of the invocation"
  - name: invalid_amount
    input: "ledger holding one expense; `node dist/cli.js add abc coffee`"
    expected: "E_USAGE; exit 2"
  - name: unreadable_store
    input: "ledger file whose bytes are `not json`; `node dist/cli.js add 12.5 coffee`"
    expected: "E_UNREADABLE_STORE; exit 1; stderr `error: cannot read <path>`"
negative_oracle:
  - input_class: invalid_amount
    must_fail_with: "E_USAGE"
    must_not: "a new expense in the ledger file and any stdout line"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "the ledger file being overwritten, any stdout line and any `#` confirmation line"
assertion_summary:
  - "the stdout line has exactly four space separated fields in the order id, amount, category, date"
  - "the amount field of stdout carries exactly two decimals and the stored amount is an integer count of cents"
  - "the assigned id is greater than every id present in the ledger file before the invocation"
  - "the explicit --date value is printed and stored verbatim, and without --date the date is the UTC day of the invocation"
  - "a rejected add leaves the ledger file bytes unchanged and a failed read leaves the file bytes unchanged"
feasibility: feasible
```

### expense-ledger-cli:CTR-002

```yaml
id: expense-ledger-cli:CTR-002
template: Contract
obligation: "list prints every matching expense as `#<id> <date> <amount> <category>` plus ` — <note>` when a note exists, ordered by date then id, with no byte written when nothing matches"
input_classes:
  - name: no_filters
    input: "ledger holding id 1 (2026-02-01, food), id 2 (2026-01-31, travel, note taxi); `node dist/cli.js list`"
    expected: "exit 0; stdout `#2 2026-01-31 5.00 travel — taxi` then `#1 2026-02-01 12.50 food`"
  - name: category_filter
    input: "ledger holding a food and a travel expense; `node dist/cli.js list --category food`"
    expected: "exit 0; only the food line is printed"
  - name: inclusive_bounds
    input: "ledger holding expenses dated 2026-01-01, 2026-01-31 and 2026-02-01; `node dist/cli.js list --from 2026-01-01 --to 2026-01-31`"
    expected: "exit 0; the 2026-01-01 line and the 2026-01-31 line are printed, the 2026-02-01 line is not"
  - name: no_match
    input: "ledger holding only travel expenses; `node dist/cli.js list --category food`"
    expected: "exit 0; stdout has zero bytes"
  - name: invalid_option_value
    input: "ledger holding expenses; `node dist/cli.js list --category` with no following value"
    expected: "E_USAGE; exit 2"
  - name: unreadable_store
    input: "ledger file whose bytes are `{`; `node dist/cli.js list`"
    expected: "E_UNREADABLE_STORE; exit 1; stderr `error: cannot read <path>`"
negative_oracle:
  - input_class: invalid_option_value
    must_fail_with: "E_USAGE"
    must_not: "any stdout byte"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte and any expense line"
assertion_summary:
  - "each printed line has the field order id, date, amount, category and the optional ` — <note>` suffix"
  - "the printed lines are non-decreasing in date and ascending in id within one date"
  - "only expenses satisfying every supplied filter are printed, and both range bounds are inclusive"
  - "a filter that matches nothing writes zero stdout bytes with exit code 0"
feasibility: feasible
```

### expense-ledger-cli:CTR-003

```yaml
id: expense-ledger-cli:CTR-003
template: Contract
obligation: "summary prints one line per category ordered by total descending then category name, then the `total <total>` line, and `total 0.00` for an empty ledger"
input_classes:
  - name: no_expenses
    input: "absent ledger file; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `total 0.00`"
  - name: one_category
    input: "ledger with food totalling 3000; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `food 30.00`, `total 30.00`"
  - name: equal_totals
    input: "ledger with food totalling 2500 and home totalling 2500; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `food 25.00`, `home 25.00`, `total 50.00`"
  - name: month_filter
    input: "ledger with a food expense dated 2026-02-10 and a travel expense dated 2026-03-01; `node dist/cli.js summary --month 2026-02`"
    expected: "exit 0; stdout is `food 12.50`, `total 12.50`"
  - name: invalid_month
    input: "ledger with expenses; `node dist/cli.js summary --month 2026-13`"
    expected: "E_USAGE; exit 2"
  - name: unreadable_store
    input: "ledger file whose bytes are `]`; `node dist/cli.js summary`"
    expected: "E_UNREADABLE_STORE; exit 1; stderr `error: cannot read <path>`"
negative_oracle:
  - input_class: invalid_month
    must_fail_with: "E_USAGE"
    must_not: "any stdout line, including a total line"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any category line or total line on stdout"
assertion_summary:
  - "the final stdout line is `total <total>` and the total carries exactly two decimals"
  - "category lines precede the total line and each is `<category> <total>`"
  - "category lines are ordered by total descending, alphabetical among equal totals"
  - "the empty ledger produces exactly `total 0.00` with no category line"
feasibility: feasible
```

### expense-ledger-cli:CTR-004

```yaml
id: expense-ledger-cli:CTR-004
template: Contract
obligation: "rm removes exactly the expense with the given id and prints `#<id> removed`, an unknown id exits 1 with `error: no expense #<id>`, and a malformed id exits 2"
input_classes:
  - name: existing_id
    input: "ledger holding ids 1 and 2; `node dist/cli.js rm 1`"
    expected: "exit 0; stdout `#1 removed`; only the expense with id 2 remains"
  - name: unknown_id
    input: "ledger holding only the expense with id 1; `node dist/cli.js rm 7`"
    expected: "E_NO_EXPENSE; exit 1; stderr `error: no expense #7`"
  - name: non_numeric_id
    input: "ledger holding ids 1 and 2; `node dist/cli.js rm one`"
    expected: "E_USAGE; exit 2; the ledger is unchanged"
  - name: unreadable_store
    input: "ledger file whose bytes are `x`; `node dist/cli.js rm 1`"
    expected: "E_UNREADABLE_STORE; exit 1; stderr `error: cannot read <path>`"
negative_oracle:
  - input_class: unknown_id
    must_fail_with: "E_NO_EXPENSE"
    must_not: "exit code 0, the `#7 removed` confirmation and any rewrite of the ledger file"
  - input_class: non_numeric_id
    must_fail_with: "E_USAGE"
    must_not: "the `error: no expense` message, exit code 1 and any rewrite of the ledger file"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "the ledger file being overwritten and any stdout line"
assertion_summary:
  - "the stdout line of a successful rm is exactly `#<id> removed` with the requested id"
  - "the ledger file after a successful rm holds exactly the expenses whose ids differ from the requested id"
  - "an unknown id writes zero stdout bytes and leaves the ledger file bytes unchanged"
  - "the exit codes are 0, 1 and 2 for the existing, unknown and malformed id classes respectively"
feasibility: feasible
```

### expense-ledger-cli:CTR-005

```yaml
id: expense-ledger-cli:CTR-005
template: Contract
obligation: "export --csv prints the header `id,date,amount,category,note` then one CSV row per expense in id ascending order with the documented quoting"
input_classes:
  - name: quoted_note
    input: "ledger holding one expense with the note `lunch, with team`; `node dist/cli.js export --csv`"
    expected: "exit 0; the header then one row whose note field is `\"lunch, with team\"`"
  - name: no_note
    input: "ledger holding one expense without a note; `node dist/cli.js export --csv`"
    expected: "exit 0; the header then one row with an empty fifth field"
  - name: empty_ledger
    input: "absent ledger file; `node dist/cli.js export --csv`"
    expected: "exit 0; stdout is the single header line"
  - name: missing_flag
    input: "ledger holding one expense; `node dist/cli.js export`"
    expected: "E_USAGE; exit 2; no CSV on stdout"
  - name: unreadable_store
    input: "ledger file whose bytes are `[`; `node dist/cli.js export --csv`"
    expected: "E_UNREADABLE_STORE; exit 1; stderr `error: cannot read <path>`"
negative_oracle:
  - input_class: missing_flag
    must_fail_with: "E_USAGE"
    must_not: "the header line and any row on stdout"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "the header line and any row on stdout"
assertion_summary:
  - "the first stdout line is exactly `id,date,amount,category,note`"
  - "each following line is one row with five fields and strictly increasing id"
  - "amount fields carry exactly two decimals and date fields are YYYY-MM-DD days"
  - "a note with a comma, a double quote or a line break sits inside one double-quoted field with inner double quotes doubled"
  - "an empty ledger prints the header and no row"
feasibility: feasible
```

### expense-ledger-cli:CTR-006

```yaml
id: expense-ledger-cli:CTR-006
template: Contract
obligation: "`ledger --help` exits 0 with a usage text naming the add, list, summary, rm and export commands and the --help option"
input_classes:
  - name: typical_absent_file
    input: "absent ledger file; `node dist/cli.js --help`"
    expected: "exit 0; stdout holds the usage text; the ledger file is still absent"
  - name: present_file
    input: "ledger file holding one expense; `node dist/cli.js --help`"
    expected: "exit 0; stdout holds the usage text; the ledger file bytes are unchanged"
  - name: boundary_every_command_named
    input: "absent ledger file; `node dist/cli.js --help`"
    expected: "stdout contains `add`, `list`, `summary`, `rm`, `export` and `--help`"
negative_oracle:
  - input_class: present_file
    must_fail_with: "E_SUCCESS"
    must_not: "any modification of the ledger file and any `error:` or `usage:` line"
assertion_summary:
  - "the exit code is 0 and stderr is empty"
  - "stdout contains each of the strings `add`, `list`, `summary`, `rm`, `export` and `--help`"
  - "the ledger file is neither created nor modified by --help"
  - "no expense line and no CSV header appears on stdout"
feasibility: feasible
```

### expense-ledger-cli:CTR-007

```yaml
id: expense-ledger-cli:CTR-007
template: Contract
obligation: "every command reads and writes the ledger at the LEDGER_FILE path, or at ./ledger.json in the working directory when the variable is unset, with the amount stored as integer cents"
input_classes:
  - name: ledger_file_set
    input: "LEDGER_FILE set to <dir>/store.json; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; the expense appears in <dir>/store.json and no file appears at ./ledger.json"
  - name: ledger_file_unset
    input: "LEDGER_FILE unset, working directory <dir>; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; the expense appears in <dir>/ledger.json"
  - name: absent_file
    input: "LEDGER_FILE set to a path that does not exist; `node dist/cli.js list`"
    expected: "exit 0; stdout has zero bytes; the file is still absent"
  - name: integer_cents
    input: "LEDGER_FILE set to <dir>/store.json; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; the stored amount of the expense is the integer 1250 and the stored category, date and id match the printed line"
  - name: unreadable_store
    input: "LEDGER_FILE set to <dir>/store.json holding the bytes `null`; `node dist/cli.js list`"
    expected: "E_UNREADABLE_STORE; exit 1; stderr `error: cannot read <dir>/store.json`"
negative_oracle:
  - input_class: absent_file
    must_fail_with: "E_SUCCESS"
    must_not: "the ledger file existing afterwards and any `error:` line"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte and any rewrite of the file"
assertion_summary:
  - "with LEDGER_FILE set every command reads and writes exactly that path and leaves ./ledger.json untouched"
  - "with LEDGER_FILE unset the ledger is read and written at ./ledger.json resolved against the working directory"
  - "the stored expense holds an integer amount in cents, never a fractional number"
  - "the stored expense carries the fields id, amount, category, date and optionally note"
feasibility: feasible
```

### expense-ledger-cli:CTR-008

```yaml
id: expense-ledger-cli:CTR-008
template: Contract
obligation: "every failing invocation exits 1 or 2, writes exactly one stderr line with the matching prefix and writes no stdout"
input_classes:
  - name: usage_error
    input: "ledger holding expenses; `node dist/cli.js add abc coffee`"
    expected: "exit 2; stderr is one line starting with `usage:`; stdout empty"
  - name: unknown_expense_id
    input: "ledger holding the expense with id 1; `node dist/cli.js rm 7`"
    expected: "exit 1; stderr is `error: no expense #7`; stdout empty"
  - name: unreadable_store
    input: "ledger file whose bytes are `{oops`; `node dist/cli.js list`"
    expected: "exit 1; stderr is `error: cannot read <path>`; stdout empty"
  - name: success
    input: "ledger holding the expense with id 1; `node dist/cli.js list`"
    expected: "exit 0; stderr empty; one expense line on stdout"
negative_oracle:
  - input_class: usage_error
    must_fail_with: "E_USAGE"
    must_not: "any stdout byte, exit code 1 and a second stderr line"
  - input_class: unknown_expense_id
    must_fail_with: "E_NO_EXPENSE"
    must_not: "any stdout byte, exit code 2 and the `usage:` prefix"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte, exit code 2 and a stack trace on stderr"
assertion_summary:
  - "the exit code is 2 exactly for the usage classes and 1 exactly for the error classes"
  - "stderr holds exactly one line and its first six characters are `usage:` or `error:` matching the code"
  - "stdout has zero bytes for every failing invocation"
  - "the error classes carry the fixed message forms `error: no expense #<id>` and `error: cannot read <path>`"
feasibility: feasible
```

### expense-ledger-cli:INV-001

```yaml
id: expense-ledger-cli:INV-001
template: Invariant
obligation: "after any sequence of add and rm no id value ever appears twice in one ledger file's history, and the first id is 1"
input_classes:
  - name: first_expense_absent_file
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; stdout begins with `#1`"
  - name: add_after_removing_highest
    input: "ledger holding ids 1 and 2; `rm 2` then `node dist/cli.js add 5 travel`"
    expected: "exit 0; stdout begins with `#3`"
  - name: add_after_removing_middle
    input: "ledger holding ids 1, 2 and 3; `rm 2` then `node dist/cli.js add 5 travel`"
    expected: "exit 0; stdout begins with an id greater than 3"
  - name: sequence_of_adds
    input: "absent ledger file; three successive `add 1 food` invocations"
    expected: "the add lines begin with `#1`, `#2`, `#3` in that order"
negative_oracle:
  - input_class: add_after_removing_highest
    must_fail_with: "E_SUCCESS"
    must_not: "the id 2 appearing again in stdout or in the ledger file after the removal"
assertion_summary:
  - "the id of the first expense written to a fresh ledger file is 1"
  - "every stdout line and every ledger file snapshot shows an id that was never used earlier in the history of that file"
  - "no ledger file snapshot ever holds two expenses with the same id"
  - "an id is never reissued after its expense is removed"
feasibility: feasible
```

### expense-ledger-cli:INV-002

```yaml
id: expense-ledger-cli:INV-002
template: Invariant
obligation: "every amount in the ledger file is an integer number of cents and every rendered amount has exactly two decimals"
input_classes:
  - name: whole_amount
    input: "absent ledger file; `node dist/cli.js add 12 coffee`"
    expected: "exit 0; stdout amount field `12.00`; the stored amount is the integer 1200"
  - name: one_fractional_digit
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; stdout amount field `12.50`; the stored amount is the integer 1250"
  - name: two_fractional_digits
    input: "absent ledger file; `node dist/cli.js add 12.50 coffee`"
    expected: "exit 0; stdout amount field `12.50`; the stored amount is the integer 1250"
  - name: invalid_amount
    input: "absent ledger file; `node dist/cli.js add abc coffee`"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: invalid_amount
    must_fail_with: "E_USAGE"
    must_not: "any amount reaching the ledger file and any stdout line"
assertion_summary:
  - "every amount recorded in the ledger file is an integer count of cents with no fractional part"
  - "every amount printed by add, list, summary or export carries exactly two digits after the decimal point"
  - "the amount for an accepted input is the same value in the ledger file and in every rendering"
feasibility: feasible
```

### expense-ledger-cli:INV-003

```yaml
id: expense-ledger-cli:INV-003
template: Invariant
obligation: "every stored date is a valid calendar day rendered as YYYY-MM-DD and the default date is the current UTC day"
input_classes:
  - name: explicit_leap_day
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee --date 2028-02-29`"
    expected: "exit 0; the date field of stdout and of the stored expense is 2028-02-29"
  - name: boundary_month_end
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee --date 2026-02-28`"
    expected: "exit 0; the stored date is 2026-02-28"
  - name: default_date
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee`"
    expected: "exit 0; the stored date equals the UTC calendar day of the invocation instant"
  - name: invalid_calendar_day
    input: "absent ledger file; `node dist/cli.js add 12.5 coffee --date 2026-02-30`"
    expected: "E_USAGE; exit 2; nothing stored"
negative_oracle:
  - input_class: invalid_calendar_day
    must_fail_with: "E_USAGE"
    must_not: "a stored expense and any stdout line"
assertion_summary:
  - "every date read from the ledger file and every date field on stdout matches YYYY-MM-DD and names a day that exists in the calendar"
  - "no stored date carries a time component or a time zone offset"
  - "without --date the printed and stored date is the UTC day of the invocation, never a day shifted by a local offset"
feasibility: infeasible_candidate
infeasibility_reason: "the clock half of the predicate needs a controlled clock and the record's own boundary class places the invocation near a UTC day boundary, which a deterministic offline test cannot produce"
```

### expense-ledger-cli:INV-004

```yaml
id: expense-ledger-cli:INV-004
template: Invariant
obligation: "list rows are non-decreasing in date and, within one date, increasing in id"
input_classes:
  - name: equal_dates
    input: "ledger holding ids 1 and 2 both dated 2026-01-05; `node dist/cli.js list`"
    expected: "exit 0; the line for id 1 precedes the line for id 2"
  - name: dates_entered_reverse
    input: "ledger holding id 1 dated 2026-03-01, added before id 2 dated 2026-01-01; `node dist/cli.js list`"
    expected: "exit 0; the line for id 2 precedes the line for id 1"
  - name: single_expense
    input: "ledger holding one expense; `node dist/cli.js list`"
    expected: "exit 0; exactly one line"
  - name: invalid_from_value
    input: "ledger holding expenses; `node dist/cli.js list --from x`"
    expected: "E_USAGE; exit 2; no rows"
negative_oracle:
  - input_class: invalid_from_value
    must_fail_with: "E_USAGE"
    must_not: "any stdout row"
assertion_summary:
  - "the date fields of the stdout lines are non-decreasing from top to bottom"
  - "within one equal date the id fields are strictly increasing"
  - "the order does not change with the order in which the expenses were added"
feasibility: feasible
```

### expense-ledger-cli:INV-005

```yaml
id: expense-ledger-cli:INV-005
template: Invariant
obligation: "summary category lines are non-increasing in total and alphabetical among equal totals, with the total line last"
input_classes:
  - name: equal_totals
    input: "ledger with food totalling 2000 and home totalling 2000; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `food 20.00`, `home 20.00`, `total 40.00`"
  - name: distinct_totals
    input: "ledger with food totalling 1000, home totalling 3000 and travel totalling 2000; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `home 30.00`, `travel 20.00`, `food 10.00`, `total 60.00`"
  - name: single_category
    input: "ledger with food totalling 1000; `node dist/cli.js summary`"
    expected: "exit 0; stdout is `food 10.00`, `total 10.00`"
  - name: invalid_month
    input: "ledger with expenses; `node dist/cli.js summary --month 2026-13`"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: invalid_month
    must_fail_with: "E_USAGE"
    must_not: "any stdout line"
assertion_summary:
  - "the totals of the category lines are non-increasing from top to bottom"
  - "categories with an equal total appear in ascending name order"
  - "the `total <total>` line is the last stdout line and appears exactly once"
  - "the total on the last line equals the sum of the category totals"
feasibility: feasible
```

### expense-ledger-cli:INV-006

```yaml
id: expense-ledger-cli:INV-006
template: Invariant
obligation: "export rows appear after the header in strictly increasing id order"
input_classes:
  - name: ids_not_in_date_order
    input: "ledger holding id 1 dated 2026-03-01, id 2 dated 2026-01-01 and id 3 dated 2026-02-01; `node dist/cli.js export --csv`"
    expected: "exit 0; the rows appear as id 1, then id 2, then id 3"
  - name: single_row
    input: "ledger holding one expense; `node dist/cli.js export --csv`"
    expected: "exit 0; the header then one row"
  - name: empty_ledger
    input: "absent ledger file; `node dist/cli.js export --csv`"
    expected: "exit 0; the header then no row"
  - name: missing_csv_flag
    input: "ledger holding expenses; `node dist/cli.js export`"
    expected: "E_USAGE; exit 2"
negative_oracle:
  - input_class: missing_csv_flag
    must_fail_with: "E_USAGE"
    must_not: "the header and any row on stdout"
assertion_summary:
  - "the id field of each row is strictly greater than the id field of the row above it"
  - "the row order is independent of the date order and of the order of insertion"
  - "the number of rows equals the number of expenses in the ledger"
feasibility: feasible
```

### expense-ledger-cli:INV-007

```yaml
id: expense-ledger-cli:INV-007
template: Invariant
obligation: "every non-zero exit prints exactly one stderr line beginning with `usage:` or `error:` and writes no stdout"
input_classes:
  - name: usage_error
    input: "`node dist/cli.js frobnicate`"
    expected: "exit 2; one stderr line starting with `usage:`; stdout empty"
  - name: error_exit_no_expense
    input: "ledger holding only the expense with id 1; `node dist/cli.js rm 7`"
    expected: "exit 1; one stderr line `error: no expense #7`; stdout empty"
  - name: error_exit_unreadable
    input: "ledger file whose bytes are `garbage`; `node dist/cli.js list`"
    expected: "exit 1; one stderr line starting with `error:`; stdout empty"
  - name: success
    input: "ledger holding the expense with id 1; `node dist/cli.js list`"
    expected: "exit 0; stderr empty; one stdout line"
negative_oracle:
  - input_class: usage_error
    must_fail_with: "E_USAGE"
    must_not: "any stdout byte and a second stderr line"
  - input_class: error_exit_no_expense
    must_fail_with: "E_NO_EXPENSE"
    must_not: "any stdout byte and a second stderr line"
  - input_class: error_exit_unreadable
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "any stdout byte and a second stderr line"
assertion_summary:
  - "for every non-zero exit the stdout byte count is 0"
  - "stderr holds exactly one line and that line begins with `usage:` or `error:`"
  - "the exit code is 2 when the prefix is `usage:` and 1 when the prefix is `error:`"
  - "a successful invocation leaves stderr empty"
feasibility: feasible
```

### expense-ledger-cli:INV-008

```yaml
id: expense-ledger-cli:INV-008
template: Invariant
obligation: "every category stored by a command matches the rule of 1 to 20 characters from lowercase letters, digits and `-`"
input_classes:
  - name: one_character
    input: "absent ledger file; `node dist/cli.js add 12.5 a`"
    expected: "exit 0; the stored category is `a`"
  - name: twenty_characters
    input: "absent ledger file; `node dist/cli.js add 12.5 abcdefghij0123456789`"
    expected: "exit 0; the stored category is 20 characters long"
  - name: twenty_one_characters
    input: "absent ledger file; `node dist/cli.js add 12.5 abcdefghij01234567890`"
    expected: "E_USAGE; exit 2; nothing stored"
  - name: invalid_uppercase
    input: "absent ledger file; `node dist/cli.js add 12.5 Coffee`"
    expected: "E_USAGE; exit 2; nothing stored"
  - name: invalid_underscore
    input: "absent ledger file; `node dist/cli.js add 12.5 food_2`"
    expected: "E_USAGE; exit 2; nothing stored"
negative_oracle:
  - input_class: twenty_one_characters
    must_fail_with: "E_USAGE"
    must_not: "a stored expense with a longer category and any stdout line"
  - input_class: invalid_uppercase
    must_fail_with: "E_USAGE"
    must_not: "a stored expense with an uppercase category"
  - input_class: invalid_underscore
    must_fail_with: "E_USAGE"
    must_not: "a stored expense with an underscore in the category"
assertion_summary:
  - "every category in the ledger file has length 1 to 20 and contains only lowercase letters, digits and `-`"
  - "the stored category equals the category argument verbatim"
  - "a rejected category leaves the ledger file without the expense"
feasibility: feasible
```

### expense-ledger-cli:POL-001

```yaml
id: expense-ledger-cli:POL-001
template: Policy
obligation: "every failing invocation maps to exactly one stable code with its documented exit status, and no failure is distinguishable only by free text"
input_classes:
  - name: usage_error
    input: "`node dist/cli.js add abc coffee`, `node dist/cli.js frobnicate` and `node dist/cli.js rm one`"
    expected: "each exits 2 with a single stderr line starting with `usage:`"
  - name: unknown_expense_id
    input: "ledger holding the expense with id 1; `node dist/cli.js rm 7`"
    expected: "exit 1; stderr `error: no expense #7`"
  - name: unreadable_store
    input: "ledger file whose bytes are `{\"a\":`; `node dist/cli.js summary`"
    expected: "exit 1; stderr `error: cannot read <path>`"
  - name: success
    input: "ledger holding the expense with id 1; `node dist/cli.js list`"
    expected: "exit 0; stderr empty"
negative_oracle:
  - input_class: usage_error
    must_fail_with: "E_USAGE"
    must_not: "exit code 1, the `error:` prefix and any stdout byte"
  - input_class: unknown_expense_id
    must_fail_with: "E_NO_EXPENSE"
    must_not: "exit code 2 and the `usage:` prefix"
  - input_class: unreadable_store
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "exit code 2 and any stdout byte"
assertion_summary:
  - "each class produces exactly one of the four codes of section 2 and no other exit status"
  - "the pair of code and exit status is the same on every invocation of the same class"
  - "two failures of different classes never share an exit status with identical message shape and can be told apart by the prefix or the fixed message form"
  - "no failure is reported only by free text with exit code 0"
feasibility: feasible
```

### expense-ledger-cli:POL-002

```yaml
id: expense-ledger-cli:POL-002
template: Policy
obligation: "invalid command-line input and an unreadable ledger file always end in exit 1 or 2 with a single stderr line, and the process keeps serving later invocations"
input_classes:
  - name: invalid_amount
    input: "`node dist/cli.js add abc coffee`"
    expected: "E_USAGE; exit 2; one stderr line"
  - name: invalid_category
    input: "`node dist/cli.js add 12.5 Coffee`"
    expected: "E_USAGE; exit 2; one stderr line"
  - name: invalid_date
    input: "`node dist/cli.js add 12.5 coffee --date 2026-13-01`"
    expected: "E_USAGE; exit 2; one stderr line"
  - name: invalid_month
    input: "ledger holding expenses; `node dist/cli.js summary --month 2026-13`"
    expected: "E_USAGE; exit 2; one stderr line"
  - name: invalid_id
    input: "ledger holding the expense with id 1; `node dist/cli.js rm one`"
    expected: "E_USAGE; exit 2; one stderr line"
  - name: unparsable_file
    input: "ledger file whose bytes are `[1,2,3]`; `node dist/cli.js list`"
    expected: "E_UNREADABLE_STORE; exit 1; one stderr line"
negative_oracle:
  - input_class: invalid_amount
    must_fail_with: "E_USAGE"
    must_not: "a stored expense and any stack trace on stderr"
  - input_class: invalid_category
    must_fail_with: "E_USAGE"
    must_not: "a stored expense and any stack trace on stderr"
  - input_class: invalid_date
    must_fail_with: "E_USAGE"
    must_not: "a stored expense and any stack trace on stderr"
  - input_class: invalid_month
    must_fail_with: "E_USAGE"
    must_not: "any stdout line and any stack trace on stderr"
  - input_class: invalid_id
    must_fail_with: "E_USAGE"
    must_not: "a removed expense and any stack trace on stderr"
  - input_class: unparsable_file
    must_fail_with: "E_UNREADABLE_STORE"
    must_not: "an uncaught exception trace and any partial stdout line"
assertion_summary:
  - "each invalid input exits 1 or 2 with exactly one stderr line and no stack trace text"
  - "after each rejected invocation a following valid invocation exits 0, so the rejection did not corrupt the ledger file"
  - "the ledger file bytes are unchanged after every rejected invocation"
  - "no rejected value reaches the ledger file"
feasibility: feasible
```

## 4. Infeasible candidates

- expense-ledger-cli:BEH-005: the predicate needs the current UTC day and the record's boundary class requires invocations on both sides of a UTC day boundary, so the expected date depends on an uncontrolled clock. Feasible if the product offered a way to fix today in UTC for a test, or the obligation were restated over an explicit --date only.
- expense-ledger-cli:INV-003: the default-date half of the invariant reads the uncontrolled clock, so the stored default date cannot be pinned deterministically. Feasible if today in UTC could be fixed for a test; the format and calendar-day half of the invariant is already exercised by the explicit date classes in the same block.
