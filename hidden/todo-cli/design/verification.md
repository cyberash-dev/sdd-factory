# Verification design: todo-cli

## 1. Scope

Eligible approved records: 42. One block per record, in spec order.

| Template | Blocks |
| --- | --- |
| Behavior | 21 (todo-cli:BEH-001 to todo-cli:BEH-021) |
| Contract | 7 (todo-cli:CTR-001 to todo-cli:CTR-007) |
| Invariant | 7 (todo-cli:INV-001 to todo-cli:INV-007) |
| Scenario | 3 (todo-cli:SCN-001 to todo-cli:SCN-003) |
| NFR | 1 (todo-cli:NFR-001) |
| Policy | 3 (todo-cli:POL-001 to todo-cli:POL-003) |

Skipped IDs and why:

- todo-cli:BL-001 - BrownfieldBaseline, not a testable template.
- todo-cli:SUR-001 - Surface, it is the boundary every block below addresses.
- todo-cli:CON-001, todo-cli:CON-002 - Constraint, not a testable template; absence of network access and of runtime dependencies are construction properties, not boundary observables.
- todo-cli:GA-001 - GeneratedArtifact, not a testable template; its predicate is subsumed by the build obligation of todo-cli:NFR-001.
- todo-cli:IMP-001 - ImplementationBinding, not a testable template; it fixes the invocation form every block below uses as its concrete command.
- todo-cli:OQ-001 to todo-cli:OQ-011 - Open-Q, not testable; their defaults are in force through the ASSUMPTION records.
- todo-cli:ASM-001 to todo-cli:ASM-012 - ASSUMPTION, not testable; each is folded into the input classes of the blocks it touches.

## 2. Error oracle

| Error code | Observable signal | Source record |
| --- | --- | --- |
| E_OK | exit 0; no error line on stderr | todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-005, todo-cli:CTR-006, todo-cli:CTR-007 |
| E_USAGE_MISSING_ARGUMENT | exit 2; stderr exactly one line starting with `usage:`; stdout empty | todo-cli:CTR-001, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-005 |
| E_USAGE_EMPTY_TEXT | exit 2; stderr exactly one line starting with `usage:`; stdout empty | todo-cli:CTR-001, todo-cli:ASM-001 (default A of todo-cli:OQ-001) |
| E_USAGE_UNKNOWN_OPTION | exit 2; stderr exactly one line starting with `usage:`; stdout empty | todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:ASM-004 |
| E_USAGE_INVALID_ID | exit 2; stderr exactly one line starting with `usage:`; stdout empty | todo-cli:CTR-003, todo-cli:CTR-004 |
| E_NO_TASK | exit 1; stderr exactly one line `error: no task #<id>`; stdout empty | todo-cli:CTR-003, todo-cli:CTR-004 |
| E_CANNOT_READ | exit 1; stderr exactly one line `error: cannot read <path>` naming the resolved storage path; stdout empty | todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-006, todo-cli:CTR-007 |
| UNDEFINED_CODE | the spec fixes exit 2 and a stderr line starting with `usage:` for this failure and names no code | todo-cli:POL-001, todo-cli:BEH-012 |

Class-level oracle from todo-cli:POL-001: a usage error exits 2 and never 1; a store error exits 1 and never 2; every failure writes exactly one stderr line whose prefix is `usage:` or `error:`; a failing command writes nothing to stdout (todo-cli:ASM-009).

## 3. Blocks

### todo-cli:BEH-001

```yaml
id: todo-cli:BEH-001
template: Behavior
obligation: "`todo add buy milk` against an empty store prints exactly `#1 buy milk` on stdout, exits 0 and leaves one task with id 1 in the storage file"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add buy milk, with /tmp/v/s.json absent"
    expected: "exit 0; stdout exactly `#1 buy milk`; stderr empty; /tmp/v/s.json holds one task with id 1, text `buy milk`, done false and a createdAt value"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add buy milk, with /tmp/v/s.json holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout exactly `#1 buy milk`; the file holds one task with id 1 and nextId 2"
  - name: boundary_single_word
    input: "TODO_FILE=/tmp/v/s.json todo add milk, with the file absent"
    expected: "exit 0; stdout exactly `#1 milk`"
  - name: boundary_multi_word
    input: "TODO_FILE=/tmp/v/s.json todo add buy milk today, with the file absent"
    expected: "exit 0; stdout exactly `#1 buy milk today`; the stored text is `buy milk today`"
  - name: invalid_empty_text
    input: "TODO_FILE=/tmp/v/s.json todo add \"\", with the file holding two tasks"
    expected: "E_USAGE_EMPTY_TEXT; exit 2"
  - name: invalid_missing_argument
    input: "TODO_FILE=/tmp/v/s.json todo add, with the file absent"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
negative_oracle:
  - input_class: invalid_empty_text
    must_fail_with: "E_USAGE_EMPTY_TEXT"
    must_not: "a `#... ` task line on stdout and a third task in the storage file"
  - input_class: invalid_missing_argument
    must_fail_with: "E_USAGE_MISSING_ARGUMENT"
    must_not: "a `#1 ...` task line on stdout and the creation of the storage file"
assertion_summary:
  - "stdout carries exactly one line, `#1 buy milk`, and nothing else"
  - "the exit code is 0 and stderr is empty"
  - "the storage file holds exactly one task whose id is 1, whose text is `buy milk` and whose done is false"
  - "the two failure classes write no task line and leave a two-task store with two tasks"
feasibility: feasible
```

### todo-cli:BEH-002

```yaml
id: todo-cli:BEH-002
template: Behavior
obligation: "`todo add` with an empty or whitespace-only text exits 2 with exactly one `usage:` line on stderr, writes nothing to stdout and leaves the storage file byte-unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add \"   \", with the file holding two tasks"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty; the file is byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add \"\", with the file holding two tasks"
    expected: "exit 2; stderr exactly one line starting with `usage:`; the file is byte-unchanged"
  - name: boundary_single_space
    input: "TODO_FILE=/tmp/v/s.json todo add \" \", with the file absent"
    expected: "exit 2; stderr exactly one line starting with `usage:`; the file is still absent"
  - name: boundary_non_blank
    input: "TODO_FILE=/tmp/v/s.json todo add x, with the file holding two tasks"
    expected: "exit 0; stdout exactly `#3 x`; the file holds three tasks"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_USAGE_EMPTY_TEXT"
    must_not: "a task line on stdout and a changed storage file"
  - input_class: empty
    must_fail_with: "E_USAGE_EMPTY_TEXT"
    must_not: "a task line on stdout and a changed storage file"
assertion_summary:
  - "every blank-text class exits 2 and not 0 or 1"
  - "stderr of a blank-text class is exactly one line whose first characters are `usage:`"
  - "stdout of a blank-text class is zero bytes"
  - "the storage file hash of a blank-text class is identical before and after the invocation"
  - "the non-blank class stores a third task and exits 0"
feasibility: feasible
```

### todo-cli:BEH-003

```yaml
id: todo-cli:BEH-003
template: Behavior
obligation: "several words after `add` are joined with single spaces into one task whose text is the whole phrase"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add buy milk today, with the file absent"
    expected: "exit 0; stdout exactly `#1 buy milk today`; the stored text is `buy milk today`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add, with the file absent"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
  - name: boundary_one_word
    input: "TODO_FILE=/tmp/v/s.json todo add milk, with the file absent"
    expected: "exit 0; stdout exactly `#1 milk`; the stored text is `milk`"
  - name: boundary_surrounding_whitespace
    input: "TODO_FILE=/tmp/v/s.json todo add \"  buy  milk  \", with the file absent"
    expected: "exit 0; stdout exactly `#1 buy milk`; the stored text is `buy milk`"
negative_oracle:
  - input_class: empty
    must_fail_with: "E_USAGE_MISSING_ARGUMENT"
    must_not: "a task line on stdout and a created storage file"
assertion_summary:
  - "the printed text after `#1 ` carries every word given on the command line in order"
  - "the stored text of the only task equals the printed text"
  - "the invocation with three words exits 0 and is not reported as a usage error"
feasibility: feasible
```

### todo-cli:BEH-004

```yaml
id: todo-cli:BEH-004
template: Behavior
obligation: "`todo list` prints one line per open task in ascending id order and exits 0"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":4,\"tasks\":[{\"id\":1,\"text\":\"a\",\"done\":false,\"createdAt\":\"2026-10-31T10:00:00.000Z\"},{\"id\":2,\"text\":\"b\",\"done\":true,\"createdAt\":\"2026-10-31T10:00:01.000Z\"},{\"id\":3,\"text\":\"c\",\"done\":false,\"createdAt\":\"2026-10-31T10:00:02.000Z\"}]}"
    expected: "exit 0; stdout exactly two lines, `#1 a` then `#3 c`; stderr empty"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout empty; stderr empty"
  - name: boundary_completed_lower_id
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding task 1 done true with text `a` and task 2 done false with text `b`, nextId 3"
    expected: "exit 0; stdout exactly one line, `#2 b`"
  - name: boundary_control_with_all
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the three-task file of the typical class"
    expected: "exit 0; stdout exactly three lines, `#1 a`, `[x] #2 b`, `#3 c`"
  - name: invalid_unknown_option
    input: "TODO_FILE=/tmp/v/s.json todo list --bogus, with the three-task file of the typical class"
    expected: "E_USAGE_UNKNOWN_OPTION; exit 2"
negative_oracle:
  - input_class: invalid_unknown_option
    must_fail_with: "E_USAGE_UNKNOWN_OPTION"
    must_not: "any task line on stdout and a zero exit code"
assertion_summary:
  - "stdout of the typical class is exactly the two lines `#1 a` and `#3 c` with no third line"
  - "the line for the completed task 2 appears on stdout only with `--all`"
  - "the ids on stdout are strictly ascending"
  - "stderr is empty and the exit code is 0 for every listing class"
feasibility: feasible
```

### todo-cli:BEH-005

```yaml
id: todo-cli:BEH-005
template: Behavior
obligation: "`todo list --all` prints every task in ascending id order and prefixes completed tasks with the literal `[x] `"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding {\"nextId\":4,\"tasks\":[{\"id\":1,\"text\":\"a\",\"done\":false,\"createdAt\":\"2026-10-31T10:00:00.000Z\"},{\"id\":2,\"text\":\"b\",\"done\":true,\"createdAt\":\"2026-10-31T10:00:01.000Z\"},{\"id\":3,\"text\":\"c\",\"done\":false,\"createdAt\":\"2026-10-31T10:00:02.000Z\"}]}"
    expected: "exit 0; stdout exactly three lines, `#1 a`, `[x] #2 b`, `#3 c`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout empty; stderr empty"
  - name: boundary_only_completed
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding task 1 done true with text `a`, nextId 2"
    expected: "exit 0; stdout exactly one line, `[x] #1 a`"
  - name: boundary_only_open
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding task 1 done false with text `a`, nextId 2"
    expected: "exit 0; stdout exactly one line, `#1 a`"
  - name: boundary_control_without_all
    input: "TODO_FILE=/tmp/v/s.json todo list, with the three-task file of the typical class"
    expected: "exit 0; stdout exactly two lines, `#1 a` and `#3 c`"
assertion_summary:
  - "stdout of the typical class is exactly `#1 a`, `[x] #2 b`, `#3 c` in that order"
  - "the characters `[x] ` precede the id of every completed task and of no open task"
  - "the ids on stdout are strictly ascending, so completed tasks are not moved to the end"
  - "without `--all` the completed task's line is absent from stdout"
feasibility: feasible
```

### todo-cli:BEH-006

```yaml
id: todo-cli:BEH-006
template: Behavior
obligation: "`todo list` with nothing to show writes zero bytes to stdout, zero bytes to stderr and exits 0"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout zero bytes; stderr zero bytes"
  - name: empty_absent_store
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json absent"
    expected: "exit 0; stdout zero bytes; stderr zero bytes; /tmp/v/s.json still absent"
  - name: boundary_only_completed
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding one task done true and text `b`, nextId 2"
    expected: "exit 0; stdout zero bytes; stderr zero bytes"
  - name: boundary_control_with_all
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding one task done true and text `b`, nextId 2"
    expected: "exit 0; stdout exactly one line, `[x] #1 b`"
assertion_summary:
  - "stdout of every empty-listing class is zero bytes, so no blank line and no header is written"
  - "the exit code of every empty-listing class is 0"
  - "stderr of every empty-listing class is zero bytes"
feasibility: feasible
```

### todo-cli:BEH-007

```yaml
id: todo-cli:BEH-007
template: Behavior
obligation: "`todo done <id>` sets done true on an open task, prints exactly `#<id> done` and exits 0"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done 2, with the file holding task 1 open text `a` and task 2 open text `b`, nextId 3"
    expected: "exit 0; stdout exactly `#2 done`; task 2 has done true, task 1 still has done false"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "E_NO_TASK; exit 1"
  - name: boundary_lowest_id
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file holding task 1 open text `a`, nextId 2"
    expected: "exit 0; stdout exactly `#1 done`; task 1 has done true"
  - name: invalid_no_task
    input: "TODO_FILE=/tmp/v/s.json todo done 99, with the file holding tasks 1 and 2"
    expected: "E_NO_TASK; exit 1"
  - name: invalid_invalid_id
    input: "TODO_FILE=/tmp/v/s.json todo done abc, with the file holding tasks 1 and 2"
    expected: "E_USAGE_INVALID_ID; exit 2"
negative_oracle:
  - input_class: invalid_no_task
    must_fail_with: "E_NO_TASK"
    must_not: "a `#99 done` line on stdout and a zero exit code"
  - input_class: invalid_invalid_id
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "any task line on stdout and a changed storage file"
assertion_summary:
  - "stdout of the typical class is exactly the line `#2 done`"
  - "after the typical invocation the stored task 2 has done true and every other task is unchanged"
  - "the printed id equals the id that was marked"
  - "the two failure classes exit non-zero and write no task line"
feasibility: feasible
```

### todo-cli:BEH-008

```yaml
id: todo-cli:BEH-008
template: Behavior
obligation: "`todo done 2` on a task that is already completed exits 0 and prints the same line `#2 done`"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done 2, with the file holding task 1 open text `a` and task 2 done true text `b`, nextId 3"
    expected: "exit 0; stdout exactly `#2 done`; task 2 still has done true"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo done 2 twice in a row, with the file holding task 1 open text `a` and task 2 open text `b`, nextId 3"
    expected: "both invocations exit 0 with stdout exactly `#2 done`"
  - name: boundary_single_completed_task
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file holding {\"nextId\":2,\"tasks\":[{\"id\":1,\"text\":\"a\",\"done\":true,\"createdAt\":\"2026-10-31T10:00:00.000Z\"}]}"
    expected: "exit 0; stdout exactly `#1 done`; done stays true"
  - name: invalid_no_task
    input: "TODO_FILE=/tmp/v/s.json todo done 42, with the file holding tasks 1 and 2"
    expected: "E_NO_TASK; exit 1"
negative_oracle:
  - input_class: invalid_no_task
    must_fail_with: "E_NO_TASK"
    must_not: "a zero exit code and a `#42 done` line on stdout"
assertion_summary:
  - "the invocation on an already completed task exits 0"
  - "its stdout is exactly `#2 done`, byte-identical to the first invocation of the repeated sequence"
  - "no warning or second message appears on stderr"
  - "done of the task remains true after the invocation"
feasibility: feasible
```

### todo-cli:BEH-009

```yaml
id: todo-cli:BEH-009
template: Behavior
obligation: "`todo done 7` on a store without task 7 exits 1 with exactly `error: no task #7` on stderr, writes nothing to stdout and leaves the storage file byte-unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done 7, with the file holding tasks 1 and 2, nextId 3"
    expected: "exit 1; stderr exactly `error: no task #7`; stdout empty; the file byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 1; stderr exactly `error: no task #1`; stdout empty"
  - name: boundary_id_removed_earlier
    input: "TODO_FILE=/tmp/v/s.json todo done 2, with the file holding only task 1 and nextId 3 (task 2 was removed earlier)"
    expected: "exit 1; stderr exactly `error: no task #2`; the file byte-unchanged"
  - name: boundary_control_valid_id
    input: "TODO_FILE=/tmp/v/s.json todo done 2, with the file holding tasks 1 and 2, nextId 3"
    expected: "exit 0; stdout exactly `#2 done`"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_NO_TASK"
    must_not: "a zero exit code, a task line on stdout and a changed storage file"
  - input_class: boundary_id_removed_earlier
    must_fail_with: "E_NO_TASK"
    must_not: "a zero exit code, a task line on stdout and a changed storage file"
assertion_summary:
  - "stderr is exactly the one line `error: no task #7` for the typical class"
  - "the exit code is 1 and not 0 or 2"
  - "stdout is zero bytes"
  - "the storage file hash is identical before and after the invocation"
feasibility: feasible
```

### todo-cli:BEH-010

```yaml
id: todo-cli:BEH-010
template: Behavior
obligation: "`todo rm 1` removes task 1, prints exactly `#1 removed` and exits 0"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo rm 1, with the file holding task 1 text `a` and task 2 text `b`, nextId 3"
    expected: "exit 0; stdout exactly `#1 removed`; the file holds only task 2, which keeps id 2"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo rm 1, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "E_NO_TASK; exit 1"
  - name: boundary_last_remaining_task
    input: "TODO_FILE=/tmp/v/s.json todo rm 1, with the file holding only task 1 text `a`, nextId 2"
    expected: "exit 0; stdout exactly `#1 removed`; the file holds zero tasks and still records nextId 2"
  - name: invalid_repeat_removal
    input: "TODO_FILE=/tmp/v/s.json todo rm 1 twice in a row, with the file holding task 1 text `a` and task 2 text `b`, nextId 3"
    expected: "first invocation exit 0 with stdout `#1 removed`; second invocation E_NO_TASK; exit 1"
negative_oracle:
  - input_class: invalid_repeat_removal
    must_fail_with: "E_NO_TASK"
    must_not: "a second `#1 removed` line and a zero exit code on the second invocation"
assertion_summary:
  - "stdout of the typical class is exactly `#1 removed`"
  - "after the typical invocation the storage file holds one task whose id is 2"
  - "a following `todo list` prints no line for task 1"
  - "the ids of the remaining tasks are unchanged, so task 2 is still `#2`"
feasibility: feasible
```

### todo-cli:BEH-011

```yaml
id: todo-cli:BEH-011
template: Behavior
obligation: "`todo rm 5` on a store without task 5 exits 1 with exactly `error: no task #5` on stderr, writes nothing to stdout and leaves the storage file byte-unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo rm 5, with the file holding tasks 1 and 2, nextId 3"
    expected: "exit 1; stderr exactly `error: no task #5`; stdout empty; the file byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo rm 1, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 1; stderr exactly `error: no task #1`; stdout empty"
  - name: boundary_id_removed_earlier
    input: "TODO_FILE=/tmp/v/s.json todo rm 2, with the file holding only task 1 and nextId 3"
    expected: "exit 1; stderr exactly `error: no task #2`; the file byte-unchanged"
  - name: boundary_control_valid_id
    input: "TODO_FILE=/tmp/v/s.json todo rm 1, with the file holding tasks 1 and 2, nextId 3"
    expected: "exit 0; stdout exactly `#1 removed`"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_NO_TASK"
    must_not: "a zero exit code, a task line on stdout and a changed storage file"
  - input_class: boundary_id_removed_earlier
    must_fail_with: "E_NO_TASK"
    must_not: "a confirmation line on stdout and a changed storage file"
assertion_summary:
  - "stderr is exactly the one line `error: no task #5` for the typical class"
  - "the exit code is 1 and not 0 or 2"
  - "stdout is zero bytes and no confirmation is printed"
  - "the storage file hash is identical before and after the invocation"
feasibility: feasible
```

### todo-cli:BEH-012

```yaml
id: todo-cli:BEH-012
template: Behavior
obligation: "an unrecognised command exits 2 with exactly one stderr line starting with `usage:` and writes nothing to stdout"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo frobnicate, with /tmp/v/s.json absent"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo frobnicate, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_prefix_of_known_command
    input: "TODO_FILE=/tmp/v/s.json todo lis, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_single_letter
    input: "TODO_FILE=/tmp/v/s.json todo l, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
negative_oracle:
  - input_class: typical
    must_fail_with: "UNDEFINED_CODE"
    must_not: "exit code 1, a task line on stdout and a created storage file"
  - input_class: boundary_prefix_of_known_command
    must_fail_with: "UNDEFINED_CODE"
    must_not: "a successful `todo list` output, a zero exit code and a task line on stdout"
assertion_summary:
  - "every unrecognised-command class exits 2"
  - "stderr of every class is exactly one line whose first characters are `usage:`"
  - "stdout of every class is zero bytes"
  - "no stack trace appears on stderr"
  - "the storage file is unchanged or still absent after the invocation"
feasibility: infeasible_candidate
infeasibility_reason: "the spec fixes exit 2 and the `usage:` prefix for an unrecognised command but names no error code for it in any Contract error_taxonomy or in todo-cli:POL-001, so the negative oracle cannot name the code it must fail with"
```

### todo-cli:BEH-013

```yaml
id: todo-cli:BEH-013
template: Behavior
obligation: "a command whose required argument is absent exits 2 with exactly one stderr line starting with `usage:` and writes nothing to stdout"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo, with /tmp/v/s.json absent"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty; the file byte-unchanged"
  - name: boundary_done_without_id
    input: "TODO_FILE=/tmp/v/s.json todo done, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_rm_without_id
    input: "TODO_FILE=/tmp/v/s.json todo rm, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_control_list
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout empty; stderr empty"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_USAGE_MISSING_ARGUMENT"
    must_not: "a zero exit code, any task line on stdout and a process that waits for input"
  - input_class: empty
    must_fail_with: "E_USAGE_MISSING_ARGUMENT"
    must_not: "a task line on stdout and a changed storage file"
assertion_summary:
  - "every missing-argument class exits 2"
  - "stderr of every class is exactly one line whose first characters are `usage:`"
  - "stdout of every class is zero bytes"
  - "each invocation terminates without reading from stdin"
feasibility: feasible
```

### todo-cli:BEH-014

```yaml
id: todo-cli:BEH-014
template: Behavior
obligation: "an id argument that is not a decimal digit token with value at least 1 exits 2 with exactly one `usage:` line on stderr and leaves the storage file byte-unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done 0, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty; the file byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo rm, with the file holding task 1"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
  - name: boundary_negative_integer
    input: "TODO_FILE=/tmp/v/s.json todo done -1, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_non_numeric
    input: "TODO_FILE=/tmp/v/s.json todo done abc, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_fractional
    input: "TODO_FILE=/tmp/v/s.json todo rm 1.5, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; the file byte-unchanged"
  - name: boundary_control_valid_id
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file holding task 1"
    expected: "exit 0; stdout exactly `#1 done`"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "exit code 1 with a `error: no task #0` line and any task line on stdout"
  - input_class: boundary_fractional
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "a coercion of `1.5` into an integer followed by a zero exit code and a removed task"
  - input_class: boundary_negative_integer
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "a zero exit code and a task line on stdout"
assertion_summary:
  - "every invalid-id class exits 2 and not 1"
  - "stderr of every invalid-id class is exactly one line whose first characters are `usage:` and never the characters `error:`"
  - "stdout of every invalid-id class is zero bytes"
  - "the storage file hash of every invalid-id class is identical before and after the invocation"
feasibility: feasible
```

### todo-cli:BEH-015

```yaml
id: todo-cli:BEH-015
template: Behavior
obligation: "any option other than `--all` on `list` exits 2 with exactly one `usage:` line on stderr and leaves the storage file byte-unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list --bogus, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty; the file byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list --bogus, with /tmp/v/s.json absent"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty; the file still absent"
  - name: boundary_known_option_on_other_command
    input: "TODO_FILE=/tmp/v/s.json todo add --all milk, with the file holding task 1"
    expected: "E_USAGE_UNKNOWN_OPTION; exit 2"
  - name: boundary_help_option
    input: "TODO_FILE=/tmp/v/s.json todo list --help, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_control_all
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding task 1"
    expected: "exit 0; stdout exactly `#1 a`"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_USAGE_UNKNOWN_OPTION"
    must_not: "a silent success, a task line on stdout and a changed storage file"
  - input_class: boundary_help_option
    must_fail_with: "E_USAGE_UNKNOWN_OPTION"
    must_not: "the usage text on stdout and a zero exit code"
assertion_summary:
  - "every unknown-option class exits 2"
  - "stderr of every unknown-option class is exactly one line whose first characters are `usage:`"
  - "stdout of every unknown-option class is zero bytes, so the option is never ignored"
  - "the option token is never treated as a task id, so no `error: no task` line appears"
feasibility: feasible
```

### todo-cli:BEH-016

```yaml
id: todo-cli:BEH-016
template: Behavior
obligation: "a storage file that is not parseable JSON makes the command exit 1 with exactly `error: cannot read <path>` on stderr, writes nothing to stdout and leaves the file byte-unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json containing the four bytes {oops"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/s.json`; stdout empty; the file byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json a zero-byte file"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/s.json`; the file still zero bytes"
  - name: boundary_non_json_text
    input: "TODO_FILE=/tmp/v/s.json todo add x, with /tmp/v/s.json containing `not a task list`"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/s.json`; stdout empty; the file byte-unchanged"
  - name: boundary_control_valid_store
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout empty; stderr empty"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_CANNOT_READ"
    must_not: "exit code 0, a task line on stdout and a rewritten or truncated file"
  - input_class: empty
    must_fail_with: "E_CANNOT_READ"
    must_not: "a rewrite of the zero-byte file into a task list"
  - input_class: boundary_non_json_text
    must_fail_with: "E_CANNOT_READ"
    must_not: "a task line on stdout and the file replaced by a one-task list"
assertion_summary:
  - "stderr is exactly the one line `error: cannot read /tmp/v/s.json`, naming the resolved path"
  - "no message of the JSON parser is printed instead of that line"
  - "the exit code is 1 for every unparsable class"
  - "the storage file hash is identical before and after each unparsable invocation"
feasibility: feasible
```

### todo-cli:BEH-017

```yaml
id: todo-cli:BEH-017
template: Behavior
obligation: "valid JSON that is not a task list of the contract shape makes the command exit 1 with exactly `error: cannot read <path>` and leaves the file byte-unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json containing {\"hello\": 1}"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/s.json`; stdout empty; the file byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout empty; stderr empty"
  - name: boundary_root_array
    input: "TODO_FILE=/tmp/v/s.json todo add x, with /tmp/v/s.json containing []"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/s.json`; the file still contains [] with the same bytes"
  - name: boundary_root_scalar
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json containing 42"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/s.json`; the file byte-unchanged"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_CANNOT_READ"
    must_not: "exit code 0, a task line on stdout and a file replaced by a fresh list"
  - input_class: boundary_root_array
    must_fail_with: "E_CANNOT_READ"
    must_not: "the array being read as an empty store and the file rewritten with a task of id 1"
assertion_summary:
  - "every foreign-shape class exits 1 with the `error: cannot read /tmp/v/s.json` line"
  - "stdout is zero bytes for every foreign-shape class"
  - "the storage file hash is identical before and after every foreign-shape invocation"
  - "no command on a foreign-shape file prints an id, so no id is handed out on top of it"
feasibility: feasible
```

### todo-cli:BEH-018

```yaml
id: todo-cli:BEH-018
template: Behavior
obligation: "`todo list` on an absent storage file exits 0, writes nothing to either stream and does not create the file"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json absent and /tmp/v an existing directory"
    expected: "exit 0; stdout empty; stderr empty; /tmp/v/s.json still absent"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout empty; stderr empty"
  - name: boundary_default_path
    input: "TODO_FILE unset, todo list in a directory without ./todo.json"
    expected: "exit 0; stdout empty; stderr empty; ./todo.json still absent"
  - name: boundary_control_add
    input: "TODO_FILE=/tmp/v/s.json todo add first, with /tmp/v/s.json absent"
    expected: "exit 0; stdout exactly `#1 first`; the file now exists"
assertion_summary:
  - "the exit code of the absent-file listing is 0 and not 1"
  - "stdout and stderr of the absent-file listing are zero bytes"
  - "the storage path stays non-existent after the listing, so no empty file is created"
  - "the control class creates the file and stores one task, so absence and emptiness are not confused"
feasibility: feasible
```

### todo-cli:BEH-019

```yaml
id: todo-cli:BEH-019
template: Behavior
obligation: "`todo add first` on an absent storage file exits 0, prints exactly `#1 first` and creates the file holding one task with id 1"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add first, with /tmp/v/s.json absent and /tmp/v an existing directory"
    expected: "exit 0; stdout exactly `#1 first`; /tmp/v/s.json now exists and holds one task with id 1, text `first`, done false, a createdAt value, and nextId 2"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add first, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout exactly `#1 first`; the file holds one task with id 1"
  - name: boundary_default_path
    input: "TODO_FILE unset, todo add first in an empty directory"
    expected: "exit 0; stdout exactly `#1 first`; ./todo.json is created in that directory with one task"
  - name: boundary_control_list_before
    input: "TODO_FILE=/tmp/v/s.json todo list before the add, with /tmp/v/s.json absent"
    expected: "exit 0; stdout empty; the file still absent"
assertion_summary:
  - "the storage file exists after the add and can be parsed as the contract shape"
  - "it holds exactly one task and that task has id 1, text `first` and done false"
  - "the printed id is 1, so the first id in a new file is not 0 and not 2"
  - "the file is not left empty after the invocation"
feasibility: feasible
```

### todo-cli:BEH-020

```yaml
id: todo-cli:BEH-020
template: Behavior
obligation: "`todo --help` exits 0, writes a non-empty usage text to stdout, writes nothing to stderr and does not touch the storage file"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo --help, with /tmp/v/s.json absent"
    expected: "exit 0; stdout non-empty; stderr empty; /tmp/v/s.json still absent"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo --help, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout non-empty; stderr empty; the file byte-unchanged"
  - name: boundary_unparsable_store
    input: "TODO_FILE=/tmp/v/s.json todo --help, with /tmp/v/s.json containing {oops"
    expected: "exit 0; stdout non-empty; stderr empty; the file byte-unchanged"
  - name: boundary_control_bare_invocation
    input: "TODO_FILE=/tmp/v/s.json todo, with /tmp/v/s.json absent"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
negative_oracle:
  - input_class: boundary_control_bare_invocation
    must_fail_with: "E_USAGE_MISSING_ARGUMENT"
    must_not: "the usage text on stdout and a zero exit code"
assertion_summary:
  - "the exit code of `todo --help` is 0"
  - "stdout holds at least one non-whitespace character"
  - "stderr is zero bytes, so the usage text is not on the error channel"
  - "the storage file is neither created nor modified, including when it is unparsable"
feasibility: feasible
```

### todo-cli:BEH-021

```yaml
id: todo-cli:BEH-021
template: Behavior
obligation: "an invalid id argument is reported as a usage error with exit 2 even when the storage file cannot be parsed"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done abc, with /tmp/v/s.json containing {oops"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty; the file byte-unchanged"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo done abc, with /tmp/v/s.json absent"
    expected: "exit 2; stderr exactly one line starting with `usage:`; stdout empty"
  - name: boundary_valid_id_unparsable_store
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with /tmp/v/s.json containing {oops"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/s.json`; stdout empty"
  - name: boundary_control_unknown_but_valid_id
    input: "TODO_FILE=/tmp/v/s.json todo done 9, with the file holding task 1"
    expected: "exit 1; stderr exactly `error: no task #9`"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "exit code 1 and an `error: cannot read` line on stderr"
  - input_class: boundary_valid_id_unparsable_store
    must_fail_with: "E_CANNOT_READ"
    must_not: "a `usage:` line and exit code 2"
assertion_summary:
  - "the invalid-id invocation on an unparsable file exits 2 and its stderr starts with `usage:`"
  - "the valid-id invocation on the same file exits 1 and its stderr starts with `error:`"
  - "both invocations leave the unparsable file byte-unchanged"
feasibility: feasible
```

### todo-cli:CTR-001

```yaml
id: todo-cli:CTR-001
template: Contract
obligation: "`todo add <text>` stores one task and prints exactly one line `#<id> <text>` and exits 0, and answers each of its declared failure classes with its declared exit code"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add milk, with /tmp/v/s.json absent"
    expected: "exit 0; stdout exactly one line `#1 milk`; the stored task has id 1, text `milk`, done false and a createdAt value"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
  - name: boundary_several_words
    input: "TODO_FILE=/tmp/v/s.json todo add buy milk today, with /tmp/v/s.json absent"
    expected: "exit 0; stdout exactly `#1 buy milk today`"
  - name: invalid_blank_text
    input: "TODO_FILE=/tmp/v/s.json todo add \"\", with /tmp/v/s.json absent"
    expected: "E_USAGE_EMPTY_TEXT; exit 2"
  - name: invalid_option_token
    input: "TODO_FILE=/tmp/v/s.json todo add --all milk, with /tmp/v/s.json absent"
    expected: "E_USAGE_UNKNOWN_OPTION; exit 2"
  - name: invalid_cannot_read
    input: "TODO_FILE=/tmp/v/s.json todo add milk, with /tmp/v/s.json containing {oops"
    expected: "E_CANNOT_READ; exit 1"
negative_oracle:
  - input_class: invalid_blank_text
    must_fail_with: "E_USAGE_EMPTY_TEXT"
    must_not: "a `#... ` line on stdout and a created storage file"
  - input_class: invalid_option_token
    must_fail_with: "E_USAGE_UNKNOWN_OPTION"
    must_not: "a stored task whose text starts with `--` and a zero exit code"
  - input_class: invalid_cannot_read
    must_fail_with: "E_CANNOT_READ"
    must_not: "a task line on stdout and a rewritten storage file"
assertion_summary:
  - "stdout of the success classes holds exactly one line and that line matches `#<digits> <text>`"
  - "the exit code of a success class is 0 and its stderr is empty"
  - "a stored task always carries id, text, done and a createdAt value"
  - "each failure class exits with its declared code and writes exactly one stderr line"
feasibility: feasible
```

### todo-cli:CTR-002

```yaml
id: todo-cli:CTR-002
template: Contract
obligation: "`todo list` prints open tasks as `#<id> <text>` in ascending id order and `todo list --all` adds completed tasks as `[x] #<id> <text>` in the same id order"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding open task 1 `a`, completed task 2 `b` and open task 3 `c`"
    expected: "exit 0; stdout exactly `#1 a` then `#3 c`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "exit 0; stdout zero lines"
  - name: boundary_only_completed
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding completed task 1 `a` and completed task 2 `b`"
    expected: "exit 0; stdout exactly `[x] #1 a` then `[x] #2 b`"
  - name: boundary_only_open
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding open task 1 `a`"
    expected: "exit 0; stdout exactly `#1 a`"
  - name: invalid_unknown_option
    input: "TODO_FILE=/tmp/v/s.json todo list --bogus, with the file holding task 1"
    expected: "E_USAGE_UNKNOWN_OPTION; exit 2"
  - name: invalid_cannot_read
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file containing {oops"
    expected: "E_CANNOT_READ; exit 1"
negative_oracle:
  - input_class: invalid_unknown_option
    must_fail_with: "E_USAGE_UNKNOWN_OPTION"
    must_not: "any task line on stdout and a zero exit code"
  - input_class: invalid_cannot_read
    must_fail_with: "E_CANNOT_READ"
    must_not: "a task line on stdout and a rewritten storage file"
assertion_summary:
  - "the completed-task line begins with the five characters `[x] #`"
  - "open-task lines begin with `#` and carry no prefix"
  - "the ids on stdout are strictly ascending in both listing forms"
  - "an empty listing writes zero bytes and exits 0"
feasibility: feasible
```

### todo-cli:CTR-003

```yaml
id: todo-cli:CTR-003
template: Contract
obligation: "`todo done <id>` marks the task done, prints exactly `#<id> done` and exits 0, including for an already completed task, and answers each of its declared failure classes with its declared exit code"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done 2, with the file holding open task 1 `a` and open task 2 `b`"
    expected: "exit 0; stdout exactly `#2 done`; stored task 2 has done true"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo done, with the file holding task 1"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
  - name: boundary_already_completed
    input: "TODO_FILE=/tmp/v/s.json todo done 2, with the file holding completed task 1 `a` and completed task 2 `b`"
    expected: "exit 0; stdout exactly `#2 done`"
  - name: boundary_unknown_id
    input: "TODO_FILE=/tmp/v/s.json todo done 42, with the file holding task 1"
    expected: "E_NO_TASK; exit 1"
  - name: invalid_id_token
    input: "TODO_FILE=/tmp/v/s.json todo done abc, with the file holding task 1"
    expected: "E_USAGE_INVALID_ID; exit 2"
  - name: invalid_cannot_read
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file containing {oops"
    expected: "E_CANNOT_READ; exit 1"
negative_oracle:
  - input_class: boundary_already_completed
    must_fail_with: "UNDEFINED_CODE"
    must_not: "a non-zero exit code and an `error:` line for the repeated completion"
  - input_class: boundary_unknown_id
    must_fail_with: "E_NO_TASK"
    must_not: "a zero exit code and a `#42 done` line on stdout"
  - input_class: invalid_id_token
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "exit code 1 and an `error: no task` line"
  - input_class: invalid_cannot_read
    must_fail_with: "E_CANNOT_READ"
    must_not: "a task line on stdout and a rewritten storage file"
assertion_summary:
  - "stdout is exactly one line and it is `#<id> done` for the given id"
  - "the stored task is done true after a success class"
  - "the repeated completion exits 0 and writes no error line"
  - "stderr of the no-task class is exactly `error: no task #42`"
feasibility: feasible
```

### todo-cli:CTR-004

```yaml
id: todo-cli:CTR-004
template: Contract
obligation: "`todo rm <id>` removes the task, prints exactly `#<id> removed` and exits 0, and answers each of its declared failure classes with its declared exit code"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo rm 2, with the file holding task 1 `a` and task 2 `b`, nextId 3"
    expected: "exit 0; stdout exactly `#2 removed`; the file holds only task 1 with id 1"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo rm, with the file holding task 1"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
  - name: boundary_unknown_id
    input: "TODO_FILE=/tmp/v/s.json todo rm 5, with the file holding task 1"
    expected: "E_NO_TASK; exit 1"
  - name: invalid_id_token
    input: "TODO_FILE=/tmp/v/s.json todo rm 1.5, with the file holding task 1"
    expected: "E_USAGE_INVALID_ID; exit 2"
  - name: invalid_cannot_read
    input: "TODO_FILE=/tmp/v/s.json todo rm 1, with the file containing {oops"
    expected: "E_CANNOT_READ; exit 1"
negative_oracle:
  - input_class: boundary_unknown_id
    must_fail_with: "E_NO_TASK"
    must_not: "a zero exit code and a `#5 removed` line on stdout"
  - input_class: invalid_id_token
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "exit code 1 and a removed task"
  - input_class: invalid_cannot_read
    must_fail_with: "E_CANNOT_READ"
    must_not: "a confirmation line on stdout and a rewritten storage file"
assertion_summary:
  - "stdout is exactly one line and it is `#<id> removed`"
  - "the removed task is absent from the storage file after the invocation"
  - "the ids of the remaining tasks are unchanged"
  - "the next id the file hands out stays greater than every id ever used"
feasibility: feasible
```

### todo-cli:CTR-005

```yaml
id: todo-cli:CTR-005
template: Contract
obligation: "`todo --help` exits 0 and writes a non-empty usage text to stdout without reading or writing the storage file, and a bare invocation exits 2 with a `usage:` line"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo --help, with /tmp/v/s.json absent"
    expected: "exit 0; stdout non-empty; stderr empty; /tmp/v/s.json still absent"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2"
  - name: boundary_unparsable_store
    input: "TODO_FILE=/tmp/v/s.json todo --help, with /tmp/v/s.json containing {oops"
    expected: "exit 0; stdout non-empty; stderr empty; the file byte-unchanged"
  - name: boundary_control_list_help_option
    input: "TODO_FILE=/tmp/v/s.json todo list --help, with the file holding task 1"
    expected: "E_USAGE_UNKNOWN_OPTION; exit 2"
negative_oracle:
  - input_class: empty
    must_fail_with: "E_USAGE_MISSING_ARGUMENT"
    must_not: "the usage text on stdout and a zero exit code"
  - input_class: boundary_control_list_help_option
    must_fail_with: "E_USAGE_UNKNOWN_OPTION"
    must_not: "the usage text on stdout and a zero exit code"
assertion_summary:
  - "`todo --help` exits 0 with at least one non-whitespace character on stdout"
  - "its stderr is zero bytes"
  - "no storage file is created by `todo --help`, and an existing one is byte-unchanged"
  - "the bare invocation exits 2 with exactly one `usage:` line"
feasibility: feasible
```

### todo-cli:CTR-006

```yaml
id: todo-cli:CTR-006
template: Contract
obligation: "the storage file holds a root object with nextId and tasks, every task carries id, text, done and createdAt, and valid JSON of another shape is reported as E_CANNOT_READ and left unchanged"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add first then todo add second, with /tmp/v/s.json absent"
    expected: "the file parses to an object with nextId and a tasks array of two task objects, each with id, text, done and createdAt"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json absent"
    expected: "exit 0; stdout empty; the file still absent, so absence means an empty list"
  - name: boundary_several_tasks
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding tasks 1, 2 and 3 in ascending id order and nextId 4"
    expected: "exit 0; three lines in ascending id order"
  - name: invalid_other_shape
    input: "TODO_FILE=/tmp/v/s.json todo add x, with the file containing {\"hello\": 1}"
    expected: "E_CANNOT_READ; exit 1"
  - name: invalid_not_json
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file containing {oops"
    expected: "E_CANNOT_READ; exit 1"
negative_oracle:
  - input_class: invalid_other_shape
    must_fail_with: "E_CANNOT_READ"
    must_not: "a read as an empty list, a created task and a rewritten file"
  - input_class: invalid_not_json
    must_fail_with: "E_CANNOT_READ"
    must_not: "a read as an empty list and a rewritten file"
assertion_summary:
  - "the root object of a written file has the keys nextId and tasks and no task array at the root"
  - "every task object has exactly the keys id, text, done and createdAt"
  - "createdAt of a written task matches the form YYYY-MM-DDTHH:MM:SS.sssZ on every write, so no task is stored without it"
  - "a file of another shape is reported with exit 1 and is byte-unchanged"
feasibility: feasible
```

### todo-cli:CTR-007

```yaml
id: todo-cli:CTR-007
template: Contract
obligation: "the storage file is the TODO_FILE value when it is set and non-empty and ./todo.json otherwise, and the cannot-read line names that resolved path verbatim"
input_classes:
  - name: typical
    input: "TODO_FILE unset, todo add first in an empty directory"
    expected: "exit 0; stdout `#1 first`; ./todo.json exists in that directory"
  - name: empty
    input: "TODO_FILE set to the empty string, todo list in a directory without ./todo.json"
    expected: "exit 0; stdout empty; ./todo.json is used and stays absent"
  - name: boundary_absolute_path
    input: "TODO_FILE=/tmp/v/abs.json todo add first"
    expected: "exit 0; /tmp/v/abs.json exists and holds one task"
  - name: boundary_relative_path
    input: "TODO_FILE=sub/store.json todo add first, with the directory sub present"
    expected: "exit 0; sub/store.json exists relative to the current directory and holds one task"
  - name: invalid_cannot_read_named_path
    input: "TODO_FILE=/tmp/v/abs.json todo list, with /tmp/v/abs.json containing {oops"
    expected: "exit 1; stderr exactly `error: cannot read /tmp/v/abs.json`"
negative_oracle:
  - input_class: invalid_cannot_read_named_path
    must_fail_with: "E_CANNOT_READ"
    must_not: "an error line naming ./todo.json or any path other than the resolved one"
assertion_summary:
  - "with TODO_FILE unset or empty the file read and written is ./todo.json relative to the current directory"
  - "with TODO_FILE set the file at exactly that value is read and written"
  - "the cannot-read line repeats the resolved path verbatim, byte for byte"
  - "no other file in the current directory is created or changed"
feasibility: feasible
```

### todo-cli:INV-001

```yaml
id: todo-cli:INV-001
template: Invariant
obligation: "after any sequence of commands every id stored in one storage file is an integer of at least 1 and appears exactly once"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add a, then todo add b, then todo add c, with the file absent"
    expected: "the file holds three tasks with ids 1, 2 and 3, each appearing once"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "the file still holds zero tasks, so no id violates the property"
  - name: boundary_many_tasks
    input: "ten consecutive todo add invocations, with the file absent"
    expected: "the file holds ten tasks whose ids are 1 to 10 with no repetition"
  - name: boundary_after_operations
    input: "todo add a, todo done 1, todo add b, todo rm 1, todo add c"
    expected: "the remaining ids are distinct, each at least 1"
assertion_summary:
  - "after every invocation the set of ids in the storage file has the same size as the task array"
  - "every id read from the file is an integer of at least 1"
  - "no id occurs twice, whatever sequence of add, done and rm preceded the read"
feasibility: feasible
```

### todo-cli:INV-002

```yaml
id: todo-cli:INV-002
template: Invariant
obligation: "an id ever assigned to a task in one storage file is never assigned again, so every newly printed id is greater than every id ever used in that file"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add a, then todo rm 1, then todo add b"
    expected: "the third invocation prints `#2 b`, not `#1 b`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add a, with the file absent"
    expected: "the first id of a new file is 1"
  - name: boundary_remove_every_task
    input: "todo add a, todo add b, todo rm 1, todo rm 2, todo add c"
    expected: "the last invocation prints `#3 c`"
  - name: boundary_remove_highest_id
    input: "todo add a, todo add b, todo rm 2, todo add c"
    expected: "the last invocation prints `#3 c` and not `#2 c`"
assertion_summary:
  - "the id printed by a new add is strictly greater than every id printed before in the same file"
  - "the id printed by an add after removals is never one of the removed ids"
  - "the value recorded for the next id in the file never decreases across invocations"
feasibility: feasible
```

### todo-cli:INV-003

```yaml
id: todo-cli:INV-003
template: Invariant
obligation: "after every write each task object in the storage file carries id, text, done and createdAt with the types of todo-cli:CTR-006 and a non-empty text"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add buy milk, with the file absent"
    expected: "the only task has id 1, text `buy milk`, done false and a createdAt matching YYYY-MM-DDTHH:MM:SS.sssZ"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file absent"
    expected: "no file is written, so no task object exists to violate the property"
  - name: boundary_task_marked_done
    input: "todo add a, then todo done 1"
    expected: "the task still carries all four keys, done is true and createdAt is unchanged"
  - name: boundary_after_removal
    input: "todo add a, todo add b, todo rm 1"
    expected: "the remaining task carries all four keys with id 2"
assertion_summary:
  - "every task object read from the file has the four keys id, text, done and createdAt"
  - "id is an integer, text is a non-empty string, done is a boolean and createdAt is a string of the form YYYY-MM-DDTHH:MM:SS.sssZ"
  - "no task object is written without a createdAt value"
feasibility: feasible
```

### todo-cli:INV-004

```yaml
id: todo-cli:INV-004
template: Invariant
obligation: "the lines printed by `todo list` and `todo list --all` are in strictly ascending id order and contain no other line"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list --all, with the file holding open task 1 `a`, completed task 2 `b` and open task 3 `c`"
    expected: "stdout is `#1 a`, `[x] #2 b`, `#3 c`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "stdout is zero bytes"
  - name: boundary_ids_1_10_100
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding tasks with ids 1, 10 and 100 in that order"
    expected: "stdout prints `#1`, `#10`, `#100` in that order, so ordering is numeric and not lexicographic"
  - name: boundary_insertion_order
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding tasks with ids 3, 1 and 2 in that storage order"
    expected: "stdout prints the ids 1, 2, 3 in ascending order"
assertion_summary:
  - "the sequence of ids parsed from the printed lines is strictly ascending"
  - "every printed line carries a task id and no header, blank line or footer appears"
  - "the ordering does not depend on the order of the task array in the file"
feasibility: feasible
```

### todo-cli:INV-005

```yaml
id: todo-cli:INV-005
template: Invariant
obligation: "every invocation of todo exits with 0 on success, 2 on a usage error and 1 on a store error, and never with another code"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add a, with the file absent"
    expected: "exit 0"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo, with the file absent"
    expected: "exit 2"
  - name: boundary_usage_error
    input: "TODO_FILE=/tmp/v/s.json todo add \"\", with the file absent"
    expected: "exit 2; one stderr line starting with `usage:`"
  - name: boundary_store_error
    input: "TODO_FILE=/tmp/v/s.json todo done 9, with the file holding task 1"
    expected: "exit 1; one stderr line starting with `error:`"
assertion_summary:
  - "the exit status observed by the invoking shell is one of 0, 1 and 2 for every class"
  - "an exit status of 2 is accompanied by a stderr line starting with `usage:`"
  - "an exit status of 1 is accompanied by a stderr line starting with `error:`"
  - "stderr carries no stack trace for any class"
feasibility: feasible
```

### todo-cli:INV-006

```yaml
id: todo-cli:INV-006
template: Invariant
obligation: "an invocation that exits with 1 or 2 leaves the storage file byte-unchanged and creates no file"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add \"\", with the file holding two tasks"
    expected: "exit 2; the file hash before and after is identical"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list --bogus, with /tmp/v/s.json absent"
    expected: "exit 2; the file is still absent"
  - name: boundary_no_task_error
    input: "TODO_FILE=/tmp/v/s.json todo rm 9, with the file holding task 1"
    expected: "exit 1; the file hash before and after is identical"
  - name: boundary_unparsable_file
    input: "TODO_FILE=/tmp/v/s.json todo add x, with the file containing {oops"
    expected: "exit 1; the file content is still exactly `{oops`"
assertion_summary:
  - "the storage file hash is identical before and after every failing invocation"
  - "an absent storage file is still absent after a failing invocation"
  - "an unparsable storage file keeps its exact bytes after a failing invocation"
feasibility: feasible
```

### todo-cli:INV-007

```yaml
id: todo-cli:INV-007
template: Invariant
obligation: "`todo list` and `todo --help` never write or create the storage file, while `todo add`, `todo done` and `todo rm` do write it"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo list, with /tmp/v/s.json absent"
    expected: "exit 0; the file is still absent afterwards"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo --help, with /tmp/v/s.json absent"
    expected: "exit 0; the file is still absent afterwards"
  - name: boundary_existing_file
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding two tasks"
    expected: "exit 0; the file content and modification time are unchanged"
  - name: boundary_writers
    input: "TODO_FILE=/tmp/v/s.json todo add c, with the file holding tasks 1 and 2"
    expected: "exit 0; the file now holds three tasks"
assertion_summary:
  - "after `todo list` and after `todo --help` the storage file is absent when it was absent"
  - "after `todo list` on an existing file the bytes and the modification time are unchanged"
  - "`todo add` on the same state changes the file content"
feasibility: feasible
```

### todo-cli:SCN-001

```yaml
id: todo-cli:SCN-001
template: Scenario
obligation: "the seven-step lifecycle add, list, done, list, list --all, rm, list produces the listed stdout lines and exit codes in that order"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json, the file absent, then todo add buy milk, todo list, todo done 1, todo list, todo list --all, todo rm 1, todo list"
    expected: "the seven stdout values `#1 buy milk`, `#1 buy milk`, `#1 done`, empty, `[x] #1 buy milk`, `#1 removed`, empty with exit 0 each"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding {\"nextId\":1,\"tasks\":[]} before the sequence starts"
    expected: "the same seven outputs, because the sequence starts from an empty list"
  - name: boundary_populated_store
    input: "the same sequence with the file already holding task 5 `x` and nextId 6"
    expected: "the first step prints `#6 buy milk` and the following steps address task 6"
observable_sequence:
  - "`todo add buy milk` -> exit 0, stdout `#1 buy milk`, the storage file now exists"
  - "`todo list` -> exit 0, stdout `#1 buy milk`"
  - "`todo done 1` -> exit 0, stdout `#1 done`"
  - "`todo list` -> exit 0, stdout zero bytes"
  - "`todo list --all` -> exit 0, stdout `[x] #1 buy milk`"
  - "`todo rm 1` -> exit 0, stdout `#1 removed`"
  - "`todo list` -> exit 0, stdout zero bytes"
assertion_summary:
  - "each step's stdout equals the value listed for it in the observable sequence"
  - "every step exits 0 and writes nothing to stderr"
  - "after the sixth step the following `todo list` prints no line for task 1"
  - "the completed task is printed by `todo list --all` at the fifth step and absent from `todo list` at the fourth"
feasibility: feasible
```

### todo-cli:SCN-002

```yaml
id: todo-cli:SCN-002
template: Scenario
obligation: "two consecutive `todo done 1` invocations on one open task both exit 0 and print the identical line `#1 done`"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done 1 twice, with the file holding task 1 open text `a`, nextId 2"
    expected: "both invocations exit 0 with stdout `#1 done`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo done 1 twice, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "first invocation E_NO_TASK; exit 1, second invocation the same"
  - name: boundary_open_task
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file holding task 1 open"
    expected: "exit 0; stdout `#1 done`"
  - name: boundary_already_completed_task
    input: "TODO_FILE=/tmp/v/s.json todo done 1, with the file holding {\"nextId\":2,\"tasks\":[{\"id\":1,\"text\":\"a\",\"done\":true,\"createdAt\":\"2026-10-31T10:00:00.000Z\"}]}"
    expected: "exit 0; stdout `#1 done`"
negative_oracle:
  - input_class: empty
    must_fail_with: "E_NO_TASK"
    must_not: "a `#1 done` line and a zero exit code"
observable_sequence:
  - "first `todo done 1` -> exit 0, stdout `#1 done`"
  - "second `todo done 1` -> exit 0, stdout `#1 done`"
assertion_summary:
  - "both invocations exit 0"
  - "the two stdout values are byte-identical"
  - "the stored task is still done true after the second invocation"
  - "the second invocation writes nothing to stderr"
feasibility: feasible
```

### todo-cli:SCN-003

```yaml
id: todo-cli:SCN-003
template: Scenario
obligation: "the task added after a removal receives an id greater than every id ever used in the file"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add a, todo rm 1, todo add b, with the file absent at the start"
    expected: "stdout values `#1 a`, `#1 removed`, `#2 b`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo add a, with the file holding {\"nextId\":1,\"tasks\":[]}"
    expected: "stdout `#1 a`"
  - name: boundary_remove_highest_id
    input: "todo add a, todo add b, todo rm 2, todo add c"
    expected: "the last invocation prints `#3 c`"
  - name: boundary_remove_only_task
    input: "todo add a, todo rm 1, todo add b"
    expected: "the last invocation prints `#2 b`"
observable_sequence:
  - "`todo add a` -> exit 0, stdout `#1 a`"
  - "`todo rm 1` -> exit 0, stdout `#1 removed`"
  - "`todo add b` -> exit 0, stdout `#2 b`"
assertion_summary:
  - "the id printed by the third step is 2 and not 1, so the removed id is not handed out again"
  - "every step exits 0 and writes nothing to stderr"
  - "the storage file after the third step holds exactly one task whose id is 2"
feasibility: feasible
```

### todo-cli:NFR-001

```yaml
id: todo-cli:NFR-001
template: NFR
obligation: "`npm run build` exits 0 and `npm test` exits 0 with zero failing tests on the product tree"
input_classes:
  - name: typical
    input: "npm test run on a clean copy of the product tree"
    expected: "the command exits 0 and its report lists zero failing tests"
  - name: empty
    input: "npm test run on a tree in which the build output is already a full pass"
    expected: "the command exits 0 with zero failing tests"
  - name: boundary_incremental_build
    input: "npm run build run twice in a row on the same tree"
    expected: "both runs exit 0"
assertion_summary:
  - "the exit status of the build command is 0"
  - "the exit status of the test command is 0"
  - "the test report of that run lists zero failing tests"
feasibility: infeasible_candidate
infeasibility_reason: "the obligation is the exit status of the test run that would have to contain the check, a status the running test process cannot observe deterministically from inside itself; the build exit status alone is observable but the second half is self-referential"
```

### todo-cli:POL-001

```yaml
id: todo-cli:POL-001
template: Policy
obligation: "every failure exits with the code of its error class and writes exactly one stderr line whose prefix is the one its class defines"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add \"\", with the file absent"
    expected: "E_USAGE_EMPTY_TEXT; exit 2; stderr exactly one line starting with `usage:`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo, with the file absent"
    expected: "E_USAGE_MISSING_ARGUMENT; exit 2; stderr exactly one line starting with `usage:`"
  - name: boundary_usage_error
    input: "TODO_FILE=/tmp/v/s.json todo done abc, with the file holding task 1"
    expected: "E_USAGE_INVALID_ID; exit 2; stderr exactly one line starting with `usage:`"
  - name: boundary_store_error
    input: "TODO_FILE=/tmp/v/s.json todo done 9, with the file holding task 1"
    expected: "E_NO_TASK; exit 1; stderr exactly one line starting with `error:`"
  - name: boundary_unparsable_file
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file containing {oops"
    expected: "E_CANNOT_READ; exit 1; stderr exactly one line starting with `error:`"
  - name: boundary_control_success
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file holding task 1"
    expected: "E_OK; exit 0; stderr zero bytes"
negative_oracle:
  - input_class: boundary_usage_error
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "exit code 1 and an `error:` line"
  - input_class: boundary_store_error
    must_fail_with: "E_NO_TASK"
    must_not: "exit code 2 and a `usage:` line"
  - input_class: boundary_unparsable_file
    must_fail_with: "E_CANNOT_READ"
    must_not: "exit code 2 and a `usage:` line"
assertion_summary:
  - "a usage failure exits 2 and a store failure exits 1, with no crossing between the two classes"
  - "every failing invocation writes exactly one line to stderr, never two"
  - "the first characters of that line are `usage:` for a usage class and `error:` for a store class"
  - "every failing invocation writes zero bytes to stdout"
feasibility: feasible
```

### todo-cli:POL-002

```yaml
id: todo-cli:POL-002
template: Policy
obligation: "every invalid argument is answered with the exit code and stderr line of its error class and no invocation ends in an uncaught exception or a stack trace"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo done abc, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`; no stack trace"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo, with the file absent"
    expected: "exit 2; stderr exactly one line starting with `usage:`"
  - name: boundary_invalid_id
    input: "TODO_FILE=/tmp/v/s.json todo rm -1, with the file holding task 1"
    expected: "exit 2; stderr exactly one line starting with `usage:`"
  - name: boundary_unparsable_file
    input: "TODO_FILE=/tmp/v/s.json todo add x, with the file containing {oops"
    expected: "exit 1; stderr exactly one line `error: cannot read /tmp/v/s.json`"
  - name: boundary_control_next_request
    input: "after the invalid-id invocation, TODO_FILE=/tmp/v/s.json todo list with the file holding task 1"
    expected: "exit 0; stdout `#1 a`, so the tool still works after the failure"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_USAGE_INVALID_ID"
    must_not: "a stack trace or a multi-line stderr message"
  - input_class: boundary_unparsable_file
    must_fail_with: "E_CANNOT_READ"
    must_not: "an uncaught exception message or a stack trace on stderr"
assertion_summary:
  - "stderr of every invalid class is exactly one line with the contractual prefix"
  - "no stack trace, exception name or source location appears on stderr for any class"
  - "every invalid class exits with 1 or 2 and never crashes with another status"
  - "a valid invocation after an invalid one still succeeds on the same storage file"
feasibility: feasible
```

### todo-cli:POL-003

```yaml
id: todo-cli:POL-003
template: Policy
obligation: "a storage file that cannot be parsed or that holds JSON of another shape is reported as E_CANNOT_READ and never modified or treated as an empty list"
input_classes:
  - name: typical
    input: "TODO_FILE=/tmp/v/s.json todo add x, with the file containing {oops"
    expected: "E_CANNOT_READ; exit 1; the file still contains exactly `{oops`"
  - name: empty
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file a zero-byte file"
    expected: "E_CANNOT_READ; exit 1; the file still zero bytes"
  - name: boundary_other_shape_object
    input: "TODO_FILE=/tmp/v/s.json todo add x, with the file containing {\"hello\": 1}"
    expected: "E_CANNOT_READ; exit 1; the file unchanged"
  - name: boundary_root_array
    input: "TODO_FILE=/tmp/v/s.json todo list, with the file containing []"
    expected: "E_CANNOT_READ; exit 1; the file unchanged"
negative_oracle:
  - input_class: typical
    must_fail_with: "E_CANNOT_READ"
    must_not: "a write of a fresh task list over the broken file and a zero exit code"
  - input_class: boundary_other_shape_object
    must_fail_with: "E_CANNOT_READ"
    must_not: "a read of the file as an empty store followed by a task of id 1 in it"
  - input_class: boundary_root_array
    must_fail_with: "E_CANNOT_READ"
    must_not: "a read of the array as an empty list"
assertion_summary:
  - "every class exits 1 with the `error: cannot read /tmp/v/s.json` line"
  - "the bytes of the storage file are identical before and after every class"
  - "no command on a broken file prints a task line, so the file is never treated as empty"
feasibility: feasible
```

## 4. Infeasible candidates

- **todo-cli:BEH-012** - the spec fixes exit 2 and a stderr line starting with `usage:` for an unrecognised command but names no error code for it in any Contract `error_taxonomy` or in todo-cli:POL-001, so the negative oracle carries `UNDEFINED_CODE`; the observable part (exit 2, `usage:` prefix, empty stdout) is decidable. What would make it feasible: naming the code of the unrecognised-command failure in a Contract `error_taxonomy` or in todo-cli:POL-001, after which the negative oracle names that code.
- **todo-cli:NFR-001** - the obligation is the exit status and the report of the test run that would contain the check, a self-referential observation no test process can make deterministically from inside itself. What would make it feasible: an observing step outside the test run that executes the build and the test commands and records their exit status.
