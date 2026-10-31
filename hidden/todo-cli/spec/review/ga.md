# Spec review: todo-cli, round 2

decision: accept

## Findings

```yaml
- id: GA-001
  kind: gap
  target_ids: [todo-cli:CON-006]
  source: L34
  resolution: decide
  required_change: |
    CON-006 constraint becomes: the acceptance build is `npm run build`, which compiles the
    TypeScript sources with tsc and emits dist/cli.js, and the compiled CLI is invoked as
    node dist/cli.js <command>; title, rationale and test_obligation name `npm run build`
    as the observed build command. Verification: section 13 CON-006 carries exactly this
    constraint, title "acceptance build via npm run build", the rationale naming the source
    clause, and the predicate "`npm run build` exits 0, emits dist/cli.js and
    node dist/cli.js --help runs".
  assumption: null
  applied: yes
- id: GA-002
  kind: untestable
  target_ids: [todo-cli:BEH-016, todo-cli:CTR-005]
  source: L17
  resolution: decide
  required_change: |
    BEH-016 then becomes: exit 0, stdout contains each of the tokens add, list, done, rm and
    --help, and stderr is empty; CTR-005 test_obligation predicate is aligned to the same
    observable; the body of todo-cli:ASM-009 is replaced with the round-1 replacement body.
    Verification: BEH-016 then is exactly the token-set predicate, CTR-005 predicate reads
    "--help exits 0 and prints to stdout a usage text containing add, list, done, rm and
    --help", and the ASM-009 body in section 18 is inserted verbatim including
    notes 'decided by GA-002; source: L17'.
  assumption: todo-cli:ASM-009
  applied: yes
- id: GA-003
  kind: unmodeled_term
  target_ids: [todo-cli:BEH-003, todo-cli:BEH-017, todo-cli:CTR-006]
  source: none
  resolution: decide
  required_change: |
    The Glossary `path` definition is extended to state that a relative TODO_FILE value and
    the default ./todo.json both resolve against the current working directory of the
    invocation, and todo-cli:ASM-010 is inserted. Verification: the Glossary row `path`
    carries the extended definition, and the ASM-010 body in section 18 is inserted
    verbatim with source_open_q null and notes 'decided by GA-003; source: none'.
  assumption: todo-cli:ASM-010
  applied: yes
- id: GA-004
  kind: gap
  target_ids: [todo-cli:INV-001, todo-cli:CTR-006]
  source: L9
  resolution: decide
  required_change: |
    OQ-003 is closed with opt-utc-ms and the normative text states the chosen precision:
    INV-001 statement names a UTC ISO-8601 createdAt with millisecond precision and a Z
    suffix and CTR-006 item_fields.createdAt carries the same wording; ASM-003 stays as is.
    Verification: INV-001 statement and CTR-006 item_fields.createdAt both carry "UTC
    ISO-8601 timestamp with millisecond precision and a Z suffix", and ASM-003 is unchanged.
  assumption: todo-cli:ASM-003
  applied: yes
- id: GA-005
  kind: gap
  target_ids: [todo-cli:BEH-006]
  source: L14
  resolution: decide
  required_change: |
    OQ-004 is closed with opt-global-id and BEH-006 must distinguish it from opt-open-first:
    its given gains a file where the completed task has the lower id with the expected
    interleaved output, and its then states that --all prints all shown tasks in one
    ascending id order regardless of done; ASM-004 stays as is. Verification: BEH-006 given
    holds a second file with completed task 1 and open task 2, its then ends with "--all
    prints all shown tasks in one ascending id order regardless of done", and the
    test_obligation carries the same predicate and the boundary class "completed task with
    lowest id".
  assumption: todo-cli:ASM-004
  applied: yes
- id: GA-006
  kind: gap
  target_ids: [todo-cli:BEH-014, todo-cli:CTR-001]
  source: L13
  resolution: decide
  required_change: |
    OQ-005 is closed with opt-single-arg and the normative text states the rule: BEH-014
    when covers `todo add "a" "b"` with two arguments and its then gives exit 2, one stderr
    line starting with usage:, empty stdout and an unchanged storage file, stating that add
    accepts exactly one positional argument; CTR-001 schema keeps exactly one positional;
    ASM-005 stays as is. Verification: BEH-014 when and then carry the two-argument case
    and the one-positional rule, and CTR-001 schema is {subcommand: add, positional: [text],
    flags: []}.
  assumption: todo-cli:ASM-005
  applied: yes
- id: GA-007
  kind: gap
  target_ids: [todo-cli:BEH-013, todo-cli:CTR-002]
  source: L14
  resolution: decide
  required_change: |
    OQ-008 is closed with opt-usage and the normative text states the rule: BEH-013 title,
    when and then cover an unknown flag on a known command (`todo list --verbose`) as exit
    2 with a stderr line starting with usage: and an unchanged storage file; CTR-002
    error_taxonomy carries the E_USAGE entry this case needs; ASM-008 stays as is.
    Verification: BEH-013 title reads "unknown command or unknown flag exits 2 with a usage
    line", its when includes `todo list --verbose`, and CTR-002 error_taxonomy lists
    "exit 2 E_USAGE - usage line on stderr starting with usage:".
  assumption: todo-cli:ASM-008
  applied: yes
- id: GA-008
  kind: gap
  target_ids: [todo-cli:CON-005]
  source: none
  resolution: decide
  required_change: |
    CON-005 is grounded on an ASSUMPTION instead of the source: its rationale records the
    zero-dependency rule as an engineering choice with basis todo-cli:ASM-011 and its notes
    carry 'basis: todo-cli:ASM-011; source: L3-L17'; todo-cli:ASM-011 is inserted.
    Verification: CON-005 rationale and notes reference todo-cli:ASM-011, and the ASM-011
    body in section 18 is inserted verbatim with source_open_q null and notes 'decided by
    GA-008; source: none'.
  assumption: todo-cli:ASM-011
  applied: yes
```

## Assumptions

No new or replacement ASSUMPTION body is written in this round: the three bodies this review owns (todo-cli:ASM-009, todo-cli:ASM-010, todo-cli:ASM-011) are present in section 18 of spec.md verbatim as required by GA-002, GA-003 and GA-008, and every other ASSUMPTION in section 18 (ASM-001 to ASM-008) was already present and is untouched.

## Open-Q decisions

| Open-Q | option | finding | rationale |
| --- | --- | --- | --- |
| todo-cli:OQ-001 | opt-usage | none | closed in round 1; BEH-002 (exit 2, usage:) and ASM-001 verified present |
| todo-cli:OQ-002 | opt-max-plus-one | none | closed in round 1; BEH-004 and ASM-002 verified present |
| todo-cli:OQ-003 | opt-utc-ms | GA-004 | closed in round 1 via GA-004; INV-001 and CTR-006 wording verified applied |
| todo-cli:OQ-004 | opt-global-id | GA-005 | closed in round 1 via GA-005; BEH-006 ordering rule verified applied |
| todo-cli:OQ-005 | opt-single-arg | GA-006 | closed in round 1 via GA-006; BEH-014 rule and CTR-001 schema verified applied |
| todo-cli:OQ-006 | opt-storage-error | none | closed in round 1; BEH-018 and ASM-006 verified present |
| todo-cli:OQ-007 | opt-array | none | closed in round 1; CTR-006 format json_array and ASM-007 verified present |
| todo-cli:OQ-008 | opt-usage | GA-007 | closed in round 1 via GA-007; BEH-013 and CTR-002 E_USAGE verified applied |
| todo-cli:OQ-009 | opt-stdout-0 | GA-002 | closed in round 1 via GA-002; checkable predicate and ASM-009 verified applied |

## Coverage

- Coverage mapping is unchanged from round 1 and was re-checked against the current spec.md: the L34 build clause is now recorded by CON-006 (GA-001 applied), npm test by CON-003, and the invocation `node dist/cli.js <command>` by CON-006 and the Context; L3, L7-L9, L13-L17, L21-L24 and L28-L30 carry records as listed in round 1.
- No new finding is opened in round 2: this round verifies the round-1 `decide` findings only, and every one is applied.
