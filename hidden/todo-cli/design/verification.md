# Verification design: todo-cli

## 1. Scope

Eligible approved records: 31 blocks.

- Behavior: 19 blocks (todo-cli:BEH-001 … todo-cli:BEH-019).
- Contract: 6 blocks (todo-cli:CTR-001 … todo-cli:CTR-006).
- Invariant: 4 blocks (todo-cli:INV-001 … todo-cli:INV-004).
- Policy: 2 blocks (todo-cli:POL-001, todo-cli:POL-002).

IDs skipped and why:

- `todo-cli:SUR-001` (Surface): boundary descriptor, not a verifiable statement.
- Partition record `todo-cli` and `todo-cli:BL-001` (BrownfieldBaseline): not behaviour.
- `todo-cli:CON-001` … `todo-cli:CON-006` (Constraint): excluded by the verification template set.
- `todo-cli:OQ-001` … `todo-cli:OQ-009` (Open-Q) and `todo-cli:ASM-001` … `todo-cli:ASM-011` (ASSUMPTION): not testable records; their in-force defaults are already folded into the approved Behaviour, Contract and Invariant records verified here.

Conventions used in every block:

- An `input` is the command line written as the arguments after the program invocation, the value of `TODO_FILE`, and the content or absence of the storage file at the resolved path. `expected` describes exit status, stdout, stderr and the storage file at the resolved path only.
- Error codes, exit codes and message prefixes come from section 2 and nowhere else.
- A block whose failure scenarios describe a wrong result rather than a rejected input carries the check in `assertion_summary` (phrased with `never` / `must not`) and has an empty `negative_oracle`; no error code applies to such a scenario and none is invented.

## 2. Error oracle

| Error code | Observable signal | Source record |
| --- | --- | --- |
| E_SUCCESS | exit 0; result lines on stdout, stderr empty | todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-005, todo-cli:CTR-006, todo-cli:POL-001 |
| E_USAGE | exit 2; stdout empty; exactly one stderr line whose first token is `usage:` | todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:POL-001, todo-cli:POL-002 |
| E_NO_TASK | exit 1; stdout empty; exactly one stderr line `error: no task #<id>` | todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:POL-001 |
| E_STORAGE | exit 1; stdout empty; exactly one stderr line starting with `error: cannot read <path>` | todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:CTR-006, todo-cli:POL-001, todo-cli:POL-002 |

No other exit code is documented; an invocation therefore ends with 0, 1 or 2.

## 3. Blocks

### todo-cli:BEH-001

```yaml
id: todo-cli:BEH-001
template: Behavior
obligation: "add with non-blank text exits 0, prints one stdout line #<id> <text>, and leaves exactly one more task in the storage file"
input_classes:
  - name: typical
    input: "storage file holds tasks #1 alpha and #2 beta; command line: add \"milk\""
    expected: "exit 0; stdout is exactly \"#3 milk\" plus a newline; stderr empty; the storage file holds three tasks, the last one with text \"milk\""
  - name: boundary_spaces
    input: "storage file holds \"[]\"; command line: add \"buy milk and bread\""
    expected: "exit 0; stdout is exactly \"#1 buy milk and bread\" plus a newline; the stored text keeps the inner single spaces"
  - name: boundary_punctuation
    input: "storage file holds \"[]\"; command line: add \"milk, eggs & bread!\""
    expected: "exit 0; stdout is exactly \"#1 milk, eggs & bread!\" plus a newline; the stored text equals the argument byte for byte"
  - name: empty_absent_file
    input: "the storage file at the resolved path does not exist; command line: add \"milk\""
    expected: "exit 0; stdout is exactly \"#1 milk\" plus a newline; the storage file now holds one task"
  - name: invalid_blank
    input: "command line: add \"\""
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file is unchanged"
  - name: invalid_whitespace
    input: "command line: add \"   \""
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file is unchanged"
negative_oracle:
  - input_class: invalid_blank
    must_fail_with: "E_USAGE"
    must_not: "exit 0 and a task line on stdout; a new task in the storage file"
  - input_class: invalid_whitespace
    must_fail_with: "E_USAGE"
    must_not: "exit 0 and a stored task whose text is whitespace only"
assertion_summary:
  - "stdout is exactly one line of the shape #<id> <text>, where <text> equals the argument byte for byte"
  - "exit status is 0 and stderr receives no bytes"
  - "the storage file holds exactly one task more than before the invocation and that task's text equals the argument"
feasibility: feasible
```

### todo-cli:BEH-002

```yaml
id: todo-cli:BEH-002
template: Behavior
obligation: "blank text for add exits 2 with one usage-prefixed stderr line and leaves the storage file unchanged"
input_classes:
  - name: typical_non_blank
    input: "storage file holds one task; command line: add \"x\""
    expected: "exit 0; stdout is \"#2 x\" plus a newline; the storage file holds two tasks"
  - name: boundary_single_char
    input: "storage file holds \"[]\"; command line: add \"y\""
    expected: "exit 0; stdout is \"#1 y\" plus a newline; the storage file holds one task"
  - name: empty_string
    input: "storage file holds two tasks; command line: add \"\""
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file still holds two tasks"
  - name: invalid_whitespace_spaces
    input: "command line: add \"   \""
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file is unchanged"
  - name: invalid_whitespace_mixed
    input: "command line: add with one argument whose bytes are a space, a horizontal tab and a space"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file is unchanged"
negative_oracle:
  - input_class: empty_string
    must_fail_with: "E_USAGE"
    must_not: "exit 0 and a task line on stdout; an appended task"
  - input_class: invalid_whitespace_spaces
    must_fail_with: "E_USAGE"
    must_not: "exit 0 and a stored task with a blank text"
  - input_class: invalid_whitespace_mixed
    must_fail_with: "E_USAGE"
    must_not: "exit 0 and a stored task with a blank text"
assertion_summary:
  - "stdout is empty for every blank text and exit status is 2"
  - "stderr is exactly one line whose first token is usage:"
  - "the storage file content is byte-identical before and after every rejected invocation"
feasibility: feasible
```

### todo-cli:BEH-003

```yaml
id: todo-cli:BEH-003
template: Behavior
obligation: "add on a missing storage file exits 0, prints #1 first and creates the storage file at the resolved path"
input_classes:
  - name: typical_default_path
    input: "current directory holds no ./todo.json and TODO_FILE is unset; command line: add \"first\""
    expected: "exit 0; stdout is \"#1 first\" plus a newline; a storage file now exists at ./todo.json holding one task"
  - name: boundary_todo_file_path
    input: "TODO_FILE is ./custom.json and ./custom.json does not exist; command line: add \"first\""
    expected: "exit 0; stdout is \"#1 first\" plus a newline; ./custom.json exists holding one task and ./todo.json does not exist"
  - name: invalid_blank_on_missing_file
    input: "TODO_FILE is ./custom.json and ./custom.json does not exist; command line: add \"\""
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; no storage file is created at ./custom.json or at ./todo.json"
negative_oracle:
  - input_class: invalid_blank_on_missing_file
    must_fail_with: "E_USAGE"
    must_not: "exit 0; a newly created storage file at either path"
assertion_summary:
  - "exit status is 0 for the accepted invocation and the storage file exists at the resolved path afterwards"
  - "the created storage file holds exactly one task with id 1 and text \"first\""
  - "stdout is \"#1 first\" plus a newline and stderr is empty"
feasibility: feasible
```

### todo-cli:BEH-004

```yaml
id: todo-cli:BEH-004
template: Behavior
obligation: "add assigns one greater than the highest id currently stored, or 1 when no task is stored, and prints it"
input_classes:
  - name: typical_gap
    input: "storage file holds tasks with ids 1 and 3; command line: add \"next\""
    expected: "exit 0; stdout is \"#4 next\" plus a newline; the stored task has id 4"
  - name: boundary_contiguous
    input: "storage file holds tasks with ids 1, 2 and 3; command line: add \"next\""
    expected: "exit 0; stdout is \"#4 next\" plus a newline; the stored task has id 4"
  - name: boundary_removed_highest
    input: "storage file holds tasks with ids 1 and 2 after the former task 3 was removed; command line: add \"next\""
    expected: "exit 0; stdout is \"#3 next\" plus a newline; the stored task has id 3"
  - name: empty
    input: "storage file holds \"[]\"; command line: add \"next\""
    expected: "exit 0; stdout is \"#1 next\" plus a newline; the stored task has id 1"
  - name: absent
    input: "the storage file at the resolved path does not exist; command line: add \"next\""
    expected: "exit 0; stdout is \"#1 next\" plus a newline; the stored task has id 1"
assertion_summary:
  - "the new task's id is displayed in stdout as #<id> and is stored as the integer id of exactly one task"
  - "the new id never equals the id of a task already stored"
  - "no stored task ever receives id 0 or a negative id"
feasibility: feasible
```

### todo-cli:BEH-005

```yaml
id: todo-cli:BEH-005
template: Behavior
obligation: "list prints one line per open task in ascending id order and never a completed task"
input_classes:
  - name: typical
    input: "storage file holds open task #1 alpha, completed task #2 beta and open task #3 gamma; command line: list"
    expected: "exit 0; stdout is exactly two lines, \"#1 alpha\" then \"#3 gamma\"; stderr empty"
  - name: boundary_single_open_task
    input: "storage file holds open task #1 alpha and completed task #2 beta"
    expected: "exit 0; stdout is exactly one line \"#1 alpha\""
  - name: boundary_several_open_tasks
    input: "storage file holds open tasks #1 alpha, #2 beta and #3 gamma; command line: list"
    expected: "exit 0; stdout is exactly three lines in the order \"#1 alpha\", \"#2 beta\", \"#3 gamma\""
  - name: empty
    input: "storage file holds \"[]\"; command line: list"
    expected: "exit 0; stdout receives no bytes; stderr empty"
  - name: absent
    input: "the storage file at the resolved path does not exist; command line: list"
    expected: "exit 0; stdout receives no bytes; no storage file exists after the invocation"
assertion_summary:
  - "stdout contains exactly one line per open task and no line for a completed task"
  - "the lines appear in ascending id order"
  - "no line begins with the completed-task prefix"
  - "exit status is 0"
feasibility: feasible
```

### todo-cli:BEH-006

```yaml
id: todo-cli:BEH-006
template: Behavior
obligation: "list --all prints every stored task in one ascending id order with the completed-task prefix on completed lines"
input_classes:
  - name: typical_completed_high
    input: "storage file holds open task #1 alpha and completed task #2 beta; command line: list --all"
    expected: "exit 0; stdout is exactly \"#1 alpha\" then \"[x] #2 beta\""
  - name: boundary_completed_low
    input: "storage file holds completed task #1 alpha and open task #2 beta; command line: list --all"
    expected: "exit 0; stdout is exactly \"[x] #1 alpha\" then \"#2 beta\""
  - name: boundary_no_completed
    input: "storage file holds open tasks #1 alpha and #2 beta; command line: list --all"
    expected: "exit 0; stdout is exactly \"#1 alpha\" then \"#2 beta\"; no line contains the completed-task prefix"
  - name: empty
    input: "storage file holds \"[]\"; command line: list --all"
    expected: "exit 0; stdout receives no bytes; stderr empty"
  - name: absent
    input: "the storage file at the resolved path does not exist; command line: list --all"
    expected: "exit 0; stdout receives no bytes; no storage file exists after the invocation"
assertion_summary:
  - "every shown task appears on its own line and the lines are in ascending id order regardless of done"
  - "a completed task's line begins with the completed-task prefix followed by #<id> <text>; an open task's line does not"
  - "a completed task is never placed after an open task with a lower id"
  - "exit status is 0"
feasibility: feasible
```

### todo-cli:BEH-007

```yaml
id: todo-cli:BEH-007
template: Behavior
obligation: "list writes no bytes to stdout and exits 0 when no open task is stored"
input_classes:
  - name: typical_missing_file
    input: "the storage file at the resolved path does not exist; command line: list"
    expected: "exit 0; stdout receives no bytes; stderr empty; no storage file exists afterwards"
  - name: empty
    input: "storage file holds \"[]\"; command line: list"
    expected: "exit 0; stdout receives no bytes"
  - name: boundary_only_completed
    input: "storage file holds completed tasks #1 alpha and #2 beta; command line: list"
    expected: "exit 0; stdout receives no bytes"
  - name: boundary_one_open_task
    input: "storage file holds open task #1 alpha; command line: list"
    expected: "exit 0; stdout is exactly one line \"#1 alpha\""
assertion_summary:
  - "stdout receives no bytes at all, in particular no blank line and no placeholder text"
  - "exit status is 0 and stderr receives no bytes"
  - "the storage file is not created by the invocation and an existing one is unchanged"
feasibility: feasible
```

### todo-cli:BEH-008

```yaml
id: todo-cli:BEH-008
template: Behavior
obligation: "done on a stored task exits 0, prints #<id> done and persists done as true for exactly that task"
input_classes:
  - name: typical
    input: "storage file holds open task #2 beta; command line: done 2"
    expected: "exit 0; stdout is \"#2 done\" plus a newline; the stored task 2 has done true"
  - name: boundary_first_task
    input: "storage file holds open tasks #1 alpha and #2 beta; command line: done 1"
    expected: "exit 0; stdout is \"#1 done\" plus a newline; task 1 has done true and task 2 is unchanged"
  - name: boundary_last_task
    input: "storage file holds open tasks #1 alpha and #3 gamma; command line: done 3"
    expected: "exit 0; stdout is \"#3 done\" plus a newline; task 3 has done true and task 1 is unchanged"
  - name: boundary_already_completed
    input: "storage file holds completed task #2 beta; command line: done 2"
    expected: "exit 0; stdout is \"#2 done\" plus a newline; the storage file content is unchanged"
  - name: invalid_unknown_id
    input: "storage file holds open task #2 beta; command line: done 99"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #99\"; the storage file content is unchanged"
negative_oracle:
  - input_class: invalid_unknown_id
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0 and a done line on stdout; any change to the storage file"
assertion_summary:
  - "stdout is exactly \"#<id> done\" for the named id"
  - "in the storage file exactly the named task has done true, at the same id and with the same text and createdAt"
  - "exit status is 0 and stderr receives no bytes"
feasibility: feasible
```

### todo-cli:BEH-009

```yaml
id: todo-cli:BEH-009
template: Behavior
obligation: "done repeated on a completed task exits 0, prints #<id> done and leaves the storage file content unchanged"
input_classes:
  - name: typical_first_done
    input: "storage file holds open task #2 beta; command line: done 2"
    expected: "exit 0; stdout is \"#2 done\" plus a newline; task 2 has done true"
  - name: boundary_second_done
    input: "storage file holds completed task #2 beta; command line: done 2"
    expected: "exit 0; stdout is \"#2 done\" plus a newline; the storage file content is byte-identical to the content before the invocation"
  - name: boundary_third_done
    input: "storage file holds completed task #2 beta; command line: done 2 run twice in a row"
    expected: "both invocations exit 0 with stdout \"#2 done\" plus a newline; the storage file holds exactly one task with id 2"
assertion_summary:
  - "both accepted invocations exit 0 and write the same single stdout line \"#2 done\""
  - "the storage file after a repeated done holds one task with id 2 and never a duplicate task"
  - "the storage file content is unchanged by a done on an already completed task"
feasibility: feasible
```

### todo-cli:BEH-010

```yaml
id: todo-cli:BEH-010
template: Behavior
obligation: "done with an id that no stored task carries exits 1 with one error: no task #<id> stderr line and changes nothing"
input_classes:
  - name: boundary_empty_file
    input: "storage file holds \"[]\"; command line: done 7"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #7\"; the storage file content is unchanged"
  - name: boundary_gap_in_ids
    input: "storage file holds tasks #1 alpha and #3 gamma; command line: done 2"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #2\"; both tasks unchanged"
  - name: boundary_above_maximum
    input: "storage file holds tasks #1 alpha and #2 beta; command line: done 7"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #7\"; both tasks unchanged"
  - name: absent
    input: "the storage file at the resolved path does not exist; command line: done 7"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #7\"; no storage file is created"
  - name: typical_known_id
    input: "storage file holds open task #1 alpha; command line: done 1"
    expected: "exit 0; stdout is \"#1 done\" plus a newline; task 1 has done true"
negative_oracle:
  - input_class: boundary_empty_file
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; a task created with id 7"
  - input_class: boundary_gap_in_ids
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; a task created with id 2"
  - input_class: boundary_above_maximum
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; a task created with id 7"
  - input_class: absent
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; a created storage file"
assertion_summary:
  - "stdout receives no bytes and stderr is exactly one line of the shape error: no task #<id> for the requested id"
  - "exit status is 1"
  - "the storage file content is byte-identical before and after the invocation and no task is created"
feasibility: feasible
```

### todo-cli:BEH-011

```yaml
id: todo-cli:BEH-011
template: Behavior
obligation: "rm removes exactly the named task, prints #<id> removed and keeps every other task"
input_classes:
  - name: typical_first_task
    input: "storage file holds tasks #1 alpha and #2 beta; command line: rm 1"
    expected: "exit 0; stdout is \"#1 removed\" plus a newline; the storage file holds only task #2 beta"
  - name: boundary_last_task
    input: "storage file holds tasks #1 alpha and #2 beta; command line: rm 2"
    expected: "exit 0; stdout is \"#2 removed\" plus a newline; the storage file holds only task #1 alpha"
  - name: boundary_only_task
    input: "storage file holds task #1 alpha; command line: rm 1"
    expected: "exit 0; stdout is \"#1 removed\" plus a newline; the storage file holds no task and still parses as a JSON array"
  - name: invalid_unknown_id
    input: "storage file holds tasks #1 alpha and #2 beta; command line: rm 9"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #9\"; both tasks are kept unchanged"
negative_oracle:
  - input_class: invalid_unknown_id
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0 and a removed line on stdout; any task removed from the storage file"
assertion_summary:
  - "stdout is exactly \"#<id> removed\" for the named id and stderr receives no bytes"
  - "the named task's id is present in no stored task afterwards and every other task keeps its id, text, done and createdAt"
  - "exit status is 0"
feasibility: feasible
```

### todo-cli:BEH-012

```yaml
id: todo-cli:BEH-012
template: Behavior
obligation: "rm with an id that no stored task carries exits 1 with one error: no task #<id> stderr line and removes nothing"
input_classes:
  - name: boundary_empty_file
    input: "storage file holds \"[]\"; command line: rm 4"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #4\"; the storage file content is unchanged"
  - name: boundary_gap_in_ids
    input: "storage file holds tasks #1 alpha and #3 gamma; command line: rm 2"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #2\"; both tasks are kept"
  - name: boundary_above_maximum
    input: "storage file holds tasks #1 alpha and #2 beta; command line: rm 4"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #4\"; both tasks are kept"
  - name: typical_known_id
    input: "storage file holds tasks #1 alpha and #2 beta; command line: rm 2"
    expected: "exit 0; stdout is \"#2 removed\" plus a newline; the storage file holds only task #1 alpha"
negative_oracle:
  - input_class: boundary_empty_file
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0 and a removed line on stdout"
  - input_class: boundary_gap_in_ids
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; removal of task 1 or task 3"
  - input_class: boundary_above_maximum
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; removal of any task"
assertion_summary:
  - "stdout receives no bytes and stderr is exactly one line of the shape error: no task #<id> for the requested id"
  - "exit status is 1"
  - "the storage file content is byte-identical before and after the invocation"
feasibility: feasible
```

### todo-cli:BEH-013

```yaml
id: todo-cli:BEH-013
template: Behavior
obligation: "an unknown command or an unknown flag exits 2 with one usage-prefixed stderr line and leaves the storage file unchanged"
input_classes:
  - name: typical_unknown_word
    input: "storage file holds tasks #1 alpha and #2 beta; command line: frobnicate"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_unknown_flag
    input: "storage file holds open task #1 alpha; command line: list --verbose"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_empty_command_line
    input: "storage file holds open task #1 alpha; command line: no argument at all"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: invalid_known_command
    input: "storage file holds open task #1 alpha; command line: list"
    expected: "exit 0; stdout is \"#1 alpha\" plus a newline"
negative_oracle:
  - input_class: typical_unknown_word
    must_fail_with: "E_USAGE"
    must_not: "exit 0; any bytes on stdout"
  - input_class: boundary_unknown_flag
    must_fail_with: "E_USAGE"
    must_not: "exit 0 and the task list printed as if the flag were absent"
  - input_class: boundary_empty_command_line
    must_fail_with: "E_USAGE"
    must_not: "exit 0; any bytes on stdout; a modified storage file"
assertion_summary:
  - "stderr is exactly one line whose first token is usage: and stdout receives no bytes"
  - "exit status is 2 and never 1"
  - "an unknown flag never changes the exit status or the printed output of a known command"
feasibility: feasible
```

### todo-cli:BEH-014

```yaml
id: todo-cli:BEH-014
template: Behavior
obligation: "a missing positional argument, or a second positional argument to add, exits 2 with one usage-prefixed stderr line and leaves the storage file unchanged"
input_classes:
  - name: typical_missing_text
    input: "storage file holds task #1 alpha; command line: add"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_missing_id_done
    input: "storage file holds task #1 alpha; command line: done"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_missing_id_rm
    input: "storage file holds task #1 alpha; command line: rm"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_two_arguments_to_add
    input: "storage file holds task #1 alpha; command line: add \"a\" \"b\""
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file holds one task"
  - name: invalid_argument_present
    input: "storage file holds open task #1 alpha; command line: done 1"
    expected: "exit 0; stdout is \"#1 done\" plus a newline; task 1 has done true"
negative_oracle:
  - input_class: typical_missing_text
    must_fail_with: "E_USAGE"
    must_not: "exit 0; a task created with an empty text"
  - input_class: boundary_missing_id_done
    must_fail_with: "E_USAGE"
    must_not: "exit 1; a task marked done"
  - input_class: boundary_missing_id_rm
    must_fail_with: "E_USAGE"
    must_not: "exit 0; any task removed"
  - input_class: boundary_two_arguments_to_add
    must_fail_with: "E_USAGE"
    must_not: "exit 0; a task whose text joins the two arguments"
assertion_summary:
  - "every rejected command line exits 2, writes no bytes to stdout and writes exactly one stderr line whose first token is usage:"
  - "a missing argument is never reported with exit status 1"
  - "the storage file content is byte-identical before and after every rejected invocation"
feasibility: feasible
```

### todo-cli:BEH-015

```yaml
id: todo-cli:BEH-015
template: Behavior
obligation: "an id that is not a positive integer exits 2 with one usage-prefixed stderr line and leaves the storage file unchanged"
input_classes:
  - name: boundary_zero
    input: "storage file holds task #1 alpha; command line: done 0"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_negative
    input: "storage file holds task #1 alpha; command line: rm -1"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_non_numeric
    input: "storage file holds task #1 alpha; command line: done abc"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: boundary_fractional
    input: "storage file holds task #1 alpha; command line: done 1.5"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\"; the storage file content is unchanged"
  - name: typical_valid_id
    input: "storage file holds open task #1 alpha; command line: done 1"
    expected: "exit 0; stdout is \"#1 done\" plus a newline; task 1 has done true"
negative_oracle:
  - input_class: boundary_zero
    must_fail_with: "E_USAGE"
    must_not: "exit 1; any task marked done"
  - input_class: boundary_negative
    must_fail_with: "E_USAGE"
    must_not: "exit 1; any task removed"
  - input_class: boundary_non_numeric
    must_fail_with: "E_USAGE"
    must_not: "exit 1; any task marked done"
  - input_class: boundary_fractional
    must_fail_with: "E_USAGE"
    must_not: "exit 1; a task chosen by truncating or rounding the id"
assertion_summary:
  - "every rejected id exits 2, writes no bytes to stdout and writes exactly one stderr line whose first token is usage:"
  - "a non-positive-integer id is never reported as E_NO_TASK and never reaches exit status 1"
  - "the storage file content is byte-identical before and after every rejected invocation"
feasibility: feasible
```

### todo-cli:BEH-016

```yaml
id: todo-cli:BEH-016
template: Behavior
obligation: "--help exits 0, writes a usage text containing add, list, done, rm and --help to stdout, and writes nothing to stderr"
input_classes:
  - name: typical_existing_file
    input: "storage file holds tasks #1 alpha and #2 beta; command line: --help"
    expected: "exit 0; stdout contains each of the tokens add, list, done, rm and --help; stderr receives no bytes; the storage file content is unchanged"
  - name: empty_absent_file
    input: "the storage file at the resolved path does not exist; command line: --help"
    expected: "exit 0; stdout contains each of the tokens add, list, done, rm and --help; stderr receives no bytes; no storage file exists afterwards"
  - name: boundary_unreadable_file
    input: "the file named by TODO_FILE holds the text not-json-at-all; command line: --help"
    expected: "exit 0; stdout contains each of the tokens add, list, done, rm and --help; stderr receives no bytes; the storage file content is unchanged"
assertion_summary:
  - "exit status is 0 for --help, never 1 or 2"
  - "stdout contains every one of the tokens add, list, done, rm and --help"
  - "stderr receives no bytes and in particular no storage error line"
feasibility: feasible
```

### todo-cli:BEH-017

```yaml
id: todo-cli:BEH-017
template: Behavior
obligation: "list on a missing storage file exits 0, writes no bytes to stdout and creates no storage file"
input_classes:
  - name: typical_default_path
    input: "current directory holds no ./todo.json and TODO_FILE is unset; command line: list"
    expected: "exit 0; stdout receives no bytes; stderr receives no bytes; ./todo.json does not exist afterwards"
  - name: boundary_todo_file_path
    input: "TODO_FILE is ./custom.json and ./custom.json does not exist; command line: list"
    expected: "exit 0; stdout receives no bytes; ./custom.json does not exist afterwards and ./todo.json is not created"
  - name: empty
    input: "storage file holds \"[]\"; command line: list"
    expected: "exit 0; stdout receives no bytes; the storage file still holds \"[]\""
assertion_summary:
  - "exit status is 0 and both stdout and stderr receive no bytes"
  - "the storage file at the resolved path does not exist after the invocation"
  - "an existing storage file is byte-identical after the invocation"
feasibility: feasible
```

### todo-cli:BEH-018

```yaml
id: todo-cli:BEH-018
template: Behavior
obligation: "list on a storage file that holds no parseable task data exits 1 with one error: cannot read <path> stderr line and leaves the file unchanged"
input_classes:
  - name: typical_malformed_json
    input: "TODO_FILE is ./broken.json holding the text { not json; command line: list"
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" and containing ./broken.json; the file content is unchanged"
  - name: boundary_object_instead_of_array
    input: "storage file holds the text {\"tasks\":[]}; command line: list"
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" followed by the path used; the file content is unchanged"
  - name: boundary_empty_file
    input: "storage file exists with zero bytes; command line: list"
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" followed by the path used; the file content is unchanged"
  - name: invalid_parseable_file
    input: "storage file holds \"[]\"; command line: list"
    expected: "exit 0; stdout receives no bytes; stderr receives no bytes"
negative_oracle:
  - input_class: typical_malformed_json
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; any bytes on stdout; a rewritten storage file"
  - input_class: boundary_object_instead_of_array
    must_fail_with: "E_STORAGE"
    must_not: "exit 0 and an empty task list printed"
  - input_class: boundary_empty_file
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; an empty array written over the file"
assertion_summary:
  - "stderr is exactly one line that starts with error: cannot read and whose remainder names the path used for the storage file"
  - "exit status is 1 and stdout receives no bytes"
  - "the storage file content is byte-identical before and after the invocation"
feasibility: feasible
```

### todo-cli:BEH-019

```yaml
id: todo-cli:BEH-019
template: Behavior
obligation: "with TODO_FILE set, add writes the task to the named path, prints #1 env and leaves the default path untouched"
input_classes:
  - name: typical_set
    input: "TODO_FILE is ./alt.json and ./alt.json does not exist; the current directory holds no ./todo.json; command line: add \"env\""
    expected: "exit 0; stdout is \"#1 env\" plus a newline; ./alt.json holds one task with text \"env\"; ./todo.json does not exist"
  - name: boundary_relative_path
    input: "TODO_FILE is ./alt.json, ./alt.json does not exist and ./todo.json holds one task with text \"default\" and id 1; command line: add \"env\""
    expected: "exit 0; stdout is \"#1 env\" plus a newline; ./alt.json holds the new task; ./todo.json still holds only the task with text \"default\""
  - name: empty_unset
    input: "TODO_FILE is unset and ./todo.json does not exist; command line: add \"env\""
    expected: "exit 0; stdout is \"#1 env\" plus a newline; ./todo.json holds the new task"
assertion_summary:
  - "when TODO_FILE is set the task is stored in the file at that path and the default ./todo.json is neither created nor modified"
  - "exit status is 0 and stdout is \"#1 env\" plus a newline"
feasibility: feasible
```

### todo-cli:CTR-001

```yaml
id: todo-cli:CTR-001
template: Contract
obligation: "add takes exactly one positional text, exits 0 and prints #<id> <text> for non-blank text, exits 2 with a usage line for a blank text and exits 1 with a cannot-read line for an unreadable storage file"
input_classes:
  - name: typical
    input: "storage file holds \"[]\"; command line: add \"milk\""
    expected: "exit 0; stdout is \"#1 milk\" plus a newline; stderr receives no bytes"
  - name: boundary_spaces
    input: "storage file holds \"[]\"; command line: add \"buy milk\""
    expected: "exit 0; stdout is \"#1 buy milk\" plus a newline"
  - name: empty_absent_file
    input: "the storage file at the resolved path does not exist; command line: add \"milk\""
    expected: "exit 0; stdout is \"#1 milk\" plus a newline; the storage file now exists"
  - name: invalid_blank_text
    input: "command line: add \"\""
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\""
  - name: invalid_unreadable_storage
    input: "storage file holds the text not-json; command line: add \"milk\""
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" followed by the path used"
negative_oracle:
  - input_class: invalid_blank_text
    must_fail_with: "E_USAGE"
    must_not: "exit 0; a task line on stdout"
  - input_class: invalid_unreadable_storage
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a task line on stdout; a rewritten storage file"
assertion_summary:
  - "the subcommand accepts exactly one positional text and no flag; a second positional is a usage failure"
  - "the success line is #<id> <text> on stdout with exit status 0 and no bytes on stderr"
  - "the two failure classes exit with 2 and 1 respectively and write exactly one prefixed stderr line each"
feasibility: feasible
```

### todo-cli:CTR-002

```yaml
id: todo-cli:CTR-002
template: Contract
obligation: "list takes no positional and the optional --all flag, prints one line per shown task in ascending id order and nothing when empty, exits 2 with a usage line for an unknown flag and exits 1 with a cannot-read line for an unreadable storage file"
input_classes:
  - name: typical
    input: "storage file holds open task #1 alpha and completed task #2 beta; command line: list"
    expected: "exit 0; stdout is exactly \"#1 alpha\" plus a newline"
  - name: boundary_all_flag
    input: "storage file holds open task #1 alpha and completed task #2 beta; command line: list --all"
    expected: "exit 0; stdout is exactly \"#1 alpha\" then \"[x] #2 beta\""
  - name: empty
    input: "storage file holds \"[]\"; command line: list"
    expected: "exit 0; stdout receives no bytes"
  - name: invalid_unknown_flag
    input: "storage file holds open task #1 alpha; command line: list --verbose"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\""
  - name: invalid_unreadable_storage
    input: "storage file holds the text not-json; command line: list"
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" followed by the path used"
negative_oracle:
  - input_class: invalid_unknown_flag
    must_fail_with: "E_USAGE"
    must_not: "exit 0 and the task list printed"
  - input_class: invalid_unreadable_storage
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a line on stdout; a rewritten storage file"
assertion_summary:
  - "without --all no line for a completed task appears and no line begins with the completed-task prefix"
  - "with --all every stored task appears in one ascending id order"
  - "an empty or missing task list produces no bytes on stdout and exit status 0"
  - "the two failure classes exit with 2 and 1 respectively and write exactly one prefixed stderr line each"
feasibility: feasible
```

### todo-cli:CTR-003

```yaml
id: todo-cli:CTR-003
template: Contract
obligation: "done takes exactly one positive-integer id, prints #<id> done and exits 0, exits 2 with a usage line for a missing or invalid id, exits 1 with error: no task #<id> for an unknown id and exits 1 with a cannot-read line for an unreadable storage file"
input_classes:
  - name: typical_open_task
    input: "storage file holds open task #2 beta; command line: done 2"
    expected: "exit 0; stdout is \"#2 done\" plus a newline; task 2 has done true"
  - name: boundary_completed_task
    input: "storage file holds completed task #2 beta; command line: done 2"
    expected: "exit 0; stdout is \"#2 done\" plus a newline; the storage file content is unchanged"
  - name: invalid_unknown_id
    input: "storage file holds task #1 alpha; command line: done 7"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #7\""
  - name: invalid_id
    input: "storage file holds task #1 alpha; command line: done 0"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\""
  - name: invalid_unreadable_storage
    input: "storage file holds the text not-json; command line: done 1"
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" followed by the path used"
negative_oracle:
  - input_class: invalid_unknown_id
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; a done line on stdout"
  - input_class: invalid_id
    must_fail_with: "E_USAGE"
    must_not: "exit 1; any task marked done"
  - input_class: invalid_unreadable_storage
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a done line on stdout; a rewritten storage file"
assertion_summary:
  - "a done on an already completed task is a success and never a failure"
  - "the three failure classes use exit statuses 1, 2 and 1 and write exactly one prefixed stderr line each"
  - "success writes #<id> done on stdout with no bytes on stderr"
feasibility: feasible
```

### todo-cli:CTR-004

```yaml
id: todo-cli:CTR-004
template: Contract
obligation: "rm takes exactly one positive-integer id, prints #<id> removed and exits 0, exits 2 with a usage line for a missing or invalid id, exits 1 with error: no task #<id> for an unknown id and exits 1 with a cannot-read line for an unreadable storage file"
input_classes:
  - name: typical_existing_id
    input: "storage file holds tasks #1 alpha and #2 beta; command line: rm 1"
    expected: "exit 0; stdout is \"#1 removed\" plus a newline; the storage file holds only task #2 beta"
  - name: boundary_only_task
    input: "storage file holds task #1 alpha; command line: rm 1"
    expected: "exit 0; stdout is \"#1 removed\" plus a newline; the storage file holds no task"
  - name: invalid_unknown_id
    input: "storage file holds task #1 alpha; command line: rm 4"
    expected: "E_NO_TASK; exit 1; stdout empty; one stderr line \"error: no task #4\""
  - name: invalid_id
    input: "storage file holds task #1 alpha; command line: rm abc"
    expected: "E_USAGE; exit 2; stdout empty; one stderr line starting with \"usage:\""
  - name: invalid_unreadable_storage
    input: "storage file holds the text not-json; command line: rm 1"
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" followed by the path used"
negative_oracle:
  - input_class: invalid_unknown_id
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; any task removed"
  - input_class: invalid_id
    must_fail_with: "E_USAGE"
    must_not: "exit 1; any task removed"
  - input_class: invalid_unreadable_storage
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a removed line on stdout; a rewritten storage file"
assertion_summary:
  - "the three failure classes use exit statuses 1, 2 and 1 and write exactly one prefixed stderr line each"
  - "success writes #<id> removed on stdout with no bytes on stderr and removes exactly one task"
  - "a task other than the named one is never removed"
feasibility: feasible
```

### todo-cli:CTR-005

```yaml
id: todo-cli:CTR-005
template: Contract
obligation: "--help takes no positional and no flag, exits 0 and prints to stdout a usage text containing add, list, done, rm and --help"
input_classes:
  - name: typical_existing_storage
    input: "storage file holds task #1 alpha; command line: --help"
    expected: "exit 0; stdout contains each of the tokens add, list, done, rm and --help; stderr receives no bytes"
  - name: empty_absent_storage
    input: "the storage file at the resolved path does not exist; command line: --help"
    expected: "exit 0; stdout contains each of the tokens add, list, done, rm and --help; stderr receives no bytes; no storage file exists afterwards"
  - name: boundary_unreadable_storage
    input: "storage file holds the text not-json; command line: --help"
    expected: "exit 0; stdout contains each of the tokens add, list, done, rm and --help; stderr receives no bytes"
assertion_summary:
  - "exit status is 0 for every --help invocation and never 1 or 2"
  - "the usage text goes to stdout; stderr receives no bytes"
  - "stdout contains every one of the tokens add, list, done, rm and --help"
feasibility: feasible
```

### todo-cli:CTR-006

```yaml
id: todo-cli:CTR-006
template: Contract
obligation: "every command that writes leaves a JSON array whose items carry an integer id, a string text, a boolean done and a UTC ISO-8601 createdAt with millisecond precision and a Z suffix"
input_classes:
  - name: typical_first_write
    input: "storage file absent; command line: add \"milk\""
    expected: "exit 0; the storage file parses as a JSON array with one item holding id 1, text \"milk\", done false and a createdAt of the shape YYYY-MM-DDTHH:MM:SS.sssZ where the fraction has exactly three digits and the string ends with the literal Z"
  - name: boundary_write_over_existing
    input: "storage file holds a task with id 1, text \"alpha\", done false and createdAt 2026-10-31T01:58:10.267Z; command line: add \"eggs\""
    expected: "exit 0; the storage file parses as a JSON array of two items; the first item is unchanged and the second carries id 2, text \"eggs\", done false and a createdAt of the stated shape"
  - name: boundary_empty_after_last_rm
    input: "storage file holds one task with id 1; command line: rm 1"
    expected: "exit 0; the storage file still parses as a JSON array and holds no item; no task remains"
  - name: invalid_unparseable_storage
    input: "TODO_FILE is ./broken.json holding the text { not json; command line: list"
    expected: "E_STORAGE; exit 1; stdout empty; one stderr line starting with \"error: cannot read\" and containing ./broken.json"
negative_oracle:
  - input_class: invalid_unparseable_storage
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a storage file rewritten in the expected format"
assertion_summary:
  - "after every successful command the storage file parses as a JSON array"
  - "every item of that array has an integer id, a string text, a boolean done and a string createdAt"
  - "every createdAt matches the shape YYYY-MM-DDTHH:MM:SS.sssZ with exactly three fraction digits and a trailing Z, and the four components are those of a real calendar date and time"
  - "no item is written without one of the four fields"
feasibility: feasible
```

### todo-cli:INV-001

```yaml
id: todo-cli:INV-001
template: Invariant
obligation: "every task in the storage file has an integer id, a string text, a boolean done and a UTC ISO-8601 createdAt with millisecond precision and a Z suffix"
input_classes:
  - name: typical_added_task
    input: "storage file absent; command line: add \"milk\""
    expected: "the one stored item has id 1 as a JSON number, text \"milk\" as a JSON string, done false as a JSON boolean and a createdAt string of the shape YYYY-MM-DDTHH:MM:SS.sssZ"
  - name: boundary_completed_task
    input: "storage file holds one open task; command line: done 1"
    expected: "the stored item keeps an integer id, a string text, a boolean done now equal to true and a createdAt string of the stated shape"
  - name: boundary_two_tasks
    input: "storage file absent; command line: add \"alpha\" then add \"beta\""
    expected: "both stored items carry all four fields with the stated types and each createdAt is a string of the stated shape"
assertion_summary:
  - "for every item of the storage file, all four fields are present and their JSON types are number (integer), string, boolean and string"
  - "every createdAt is a string matching the shape YYYY-MM-DDTHH:MM:SS.sssZ with exactly three fraction digits and a trailing Z"
  - "no item is ever written with a field omitted"
feasibility: feasible
```

### todo-cli:INV-002

```yaml
id: todo-cli:INV-002
template: Invariant
obligation: "stored task ids are positive integers, unique within a storage file and unchanged for an existing task"
input_classes:
  - name: typical_three_adds
    input: "storage file absent; command line: add \"alpha\", then add \"beta\", then add \"gamma\""
    expected: "the storage file holds three tasks with ids 1, 2 and 3, all distinct and all positive integers"
  - name: boundary_add_after_rm
    input: "storage file holds tasks #1 alpha and #2 beta; command line: rm 1, then add \"gamma\""
    expected: "the storage file holds task 2 beta unchanged and one new task; the new id is not 2 and no two items share an id"
  - name: boundary_done_on_first_task
    input: "storage file holds tasks #1 alpha and #2 beta; command line: done 1"
    expected: "the storage file still holds tasks with ids 1 and 2 and no id changed"
assertion_summary:
  - "no two items of the storage file ever carry the same id"
  - "every stored id is a positive integer, never zero or negative"
  - "the id of an existing task is the same before and after any done or rm of another task"
feasibility: feasible
```

### todo-cli:INV-003

```yaml
id: todo-cli:INV-003
template: Invariant
obligation: "a successful invocation exits 0 with its result line on stdout and no stderr bytes, and a failing invocation exits non-zero with exactly one prefixed stderr line and no stdout bytes"
input_classes:
  - name: typical_success
    input: "storage file holds \"[]\"; command line: add \"milk\""
    expected: "exit 0; stdout is \"#1 milk\" plus a newline; stderr receives no bytes"
  - name: boundary_usage_failure
    input: "storage file holds task #1 alpha; command line: add \"\""
    expected: "E_USAGE; exit 2; stdout receives no bytes; stderr is exactly one line whose first token is usage:"
  - name: boundary_no_task_failure
    input: "storage file holds task #1 alpha; command line: done 7"
    expected: "E_NO_TASK; exit 1; stdout receives no bytes; stderr is exactly one line whose first token is error:"
  - name: boundary_storage_failure
    input: "storage file holds the text not-json; command line: list"
    expected: "E_STORAGE; exit 1; stdout receives no bytes; stderr is exactly one line whose first token is error:"
negative_oracle:
  - input_class: boundary_usage_failure
    must_fail_with: "E_USAGE"
    must_not: "exit 0; a diagnostic on stdout"
  - input_class: boundary_no_task_failure
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; a diagnostic on stdout; more than one stderr line"
  - input_class: boundary_storage_failure
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a diagnostic on stdout"
assertion_summary:
  - "exit status is 0 exactly when stdout carries the result line and stderr carries no bytes"
  - "every failing invocation exits non-zero, writes no bytes to stdout and writes exactly one stderr line"
  - "the first token of a failure line is usage: or error:, never anything else"
feasibility: feasible
```

### todo-cli:INV-004

```yaml
id: todo-cli:INV-004
template: Invariant
obligation: "list and --help never create or modify the storage file, and only a write command creates it"
input_classes:
  - name: typical_list_missing_file
    input: "current directory holds no ./todo.json; command line: list"
    expected: "exit 0; ./todo.json does not exist after the invocation"
  - name: boundary_help_missing_file
    input: "current directory holds no ./todo.json; command line: --help"
    expected: "exit 0; ./todo.json does not exist after the invocation"
  - name: boundary_list_existing_file
    input: "storage file holds \"[]\"; command line: list"
    expected: "exit 0; the storage file content is byte-identical, still \"[]\""
  - name: invalid_write_creates_file
    input: "current directory holds no ./todo.json; command line: add \"x\""
    expected: "exit 0; ./todo.json now exists holding one task"
assertion_summary:
  - "after list or --help on a missing storage file the path does not exist"
  - "after list on an existing storage file the content is byte-identical"
  - "the storage file is created only by a command that writes a task"
feasibility: feasible
```

### todo-cli:POL-001

```yaml
id: todo-cli:POL-001
template: Policy
obligation: "every failure is reported with one of E_USAGE, E_NO_TASK or E_STORAGE, its documented exit code and one stderr line whose first token is usage: or error:, and no failure is reported as success"
input_classes:
  - name: typical_success
    input: "storage file holds \"[]\"; command line: add \"milk\""
    expected: "E_SUCCESS; exit 0; stdout is \"#1 milk\" plus a newline; stderr receives no bytes"
  - name: boundary_usage_failure
    input: "storage file holds task #1 alpha; command line: add \"\""
    expected: "E_USAGE; exit 2; stdout empty; exactly one stderr line whose first token is usage:"
  - name: boundary_no_task_failure
    input: "storage file holds task #1 alpha; command line: done 7"
    expected: "E_NO_TASK; exit 1; stdout empty; exactly one stderr line of the shape error: no task #7"
  - name: boundary_storage_failure
    input: "storage file holds the text not-json; command line: list"
    expected: "E_STORAGE; exit 1; stdout empty; exactly one stderr line starting with \"error: cannot read\" followed by the path used"
negative_oracle:
  - input_class: boundary_usage_failure
    must_fail_with: "E_USAGE"
    must_not: "exit 0; a free-text-only failure without the usage: first token"
  - input_class: boundary_no_task_failure
    must_fail_with: "E_NO_TASK"
    must_not: "exit 0; a failure line without the error: first token; a diagnostic on stdout"
  - input_class: boundary_storage_failure
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a diagnostic on stdout; an exit code other than 1"
assertion_summary:
  - "every failure class ends with exit status 0 nowhere: the only exit statuses observed are 0 for success and 1 or 2 for the three documented failure classes"
  - "every failure writes exactly one stderr line and no bytes to stdout; the first token of that line is usage: or error:"
  - "no failure is reported as exit status 0 and no success writes to stderr"
feasibility: feasible
```

### todo-cli:POL-002

```yaml
id: todo-cli:POL-002
template: Policy
obligation: "rejected arguments and rejected storage content yield exit 1 or 2 with one stderr line and never a stack trace or an uncaught exception"
input_classes:
  - name: typical_valid
    input: "storage file holds open task #1 alpha; command line: done 1"
    expected: "exit 0; stdout is \"#1 done\" plus a newline; stderr receives no bytes"
  - name: boundary_missing_argument
    input: "command line: add"
    expected: "E_USAGE; exit 2; stdout empty; exactly one stderr line whose first token is usage:"
  - name: boundary_invalid_id
    input: "command line: done abc"
    expected: "E_USAGE; exit 2; stdout empty; exactly one stderr line whose first token is usage:"
  - name: boundary_malformed_storage
    input: "storage file holds the text not-json; command line: done 1"
    expected: "E_STORAGE; exit 1; stdout empty; exactly one stderr line whose first token is error:"
  - name: boundary_unknown_command
    input: "command line: frobnicate"
    expected: "E_USAGE; exit 2; stdout empty; exactly one stderr line whose first token is usage:"
negative_oracle:
  - input_class: boundary_missing_argument
    must_fail_with: "E_USAGE"
    must_not: "exit 3 or any exit code other than 2; a stack trace on stderr"
  - input_class: boundary_invalid_id
    must_fail_with: "E_USAGE"
    must_not: "an uncaught exception; more than one stderr line"
  - input_class: boundary_malformed_storage
    must_fail_with: "E_STORAGE"
    must_not: "exit 0; a stack trace on stderr"
  - input_class: boundary_unknown_command
    must_fail_with: "E_USAGE"
    must_not: "an exit code other than 2; a stack trace on stderr"
assertion_summary:
  - "every rejected input exits with 1 or 2 and never with any other non-zero status"
  - "stderr is exactly one line for every rejected input and carries no additional indented line"
  - "stdout receives no bytes for every rejected input"
feasibility: feasible
```

## 4. Infeasible candidates

none
