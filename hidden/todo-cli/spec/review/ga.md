# Spec review: todo-cli, round 2

decision: accept

## Findings

```yaml
- id: GA-001
  kind: gap
  target_ids: []
  source: L34
  resolution: decide
  required_change: |
    "Add a record of type NFR for the acceptance criterion of source L34: the project builds with `npm run build` and its tests pass with `npm test`, with a test_obligation asserting that both commands succeed on the product tree. No record of the product currently names either entry point; todo-cli:GA-001 covers only the existence of dist/cli.js and todo-cli:IMP-001 only the invocation form."
  assumption: null
  applied: yes
- id: GA-002
  kind: gap
  target_ids: [todo-cli:CTR-001, todo-cli:CTR-002, todo-cli:BEH-015, todo-cli:ASM-004]
  source: none
  resolution: decide
  required_change: |
    "The token `--help` in an argument position has no recorded outcome: todo-cli:CTR-001 exempts it from E_USAGE_UNKNOWN_OPTION (\"an option other than --help is given\") without recording what it does to `add`, and todo-cli:CTR-002 exempts it from E_USAGE_UNKNOWN_OPTION (\"an option other than --all and --help is given\") while giving `list` no other behaviour for it, so `todo list --help` and `todo add --help` are undefined. Decide: `--help` is recognized only as the command of todo-cli:CTR-005; in an argument position every token beginning with `--` is an option, and every option the Contract of the command does not define is E_USAGE_UNKNOWN_OPTION with exit 2. Edit todo-cli:CTR-001: replace the taxonomy entry \"exit 2 - E_USAGE_UNKNOWN_OPTION: an option other than --help is given\" with \"exit 2 - E_USAGE_UNKNOWN_OPTION: a token beginning with -- is given\". Edit todo-cli:CTR-002: replace that taxonomy entry with \"exit 2 - E_USAGE_UNKNOWN_OPTION: a token other than --all beginning with -- is given\". Edit todo-cli:BEH-015: change the test_obligation predicate to \"an option other than `--all` exits 2 with a `usage:` line\" and add `todo list --help` to its boundary_classes. Replace the body of todo-cli:ASM-004 with the ASSUMPTION in this review, rewriting the superseded statement under its id."
  assumption: todo-cli:ASM-004
  applied: yes
- id: GA-003
  kind: gap
  target_ids: [todo-cli:CTR-002, todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:ASM-012]
  source: none
  resolution: decide
  required_change: |
    "Positional arguments beyond the ones a Contract's schema defines (for example `todo done 1 2` or `todo list foo`) are an input class the source leaves open with no recorded reading in todo-cli:CTR-002, todo-cli:CTR-003 and todo-cli:CTR-004. Decide: such extra positional arguments are ignored and the command runs on its defined arguments (only `add` consumes every word as its text). Edit todo-cli:CTR-002, todo-cli:CTR-003 and todo-cli:CTR-004: add a compatibility rule stating that positional arguments beyond the ones the schema defines are ignored. Insert the ASSUMPTION todo-cli:ASM-012."
  assumption: todo-cli:ASM-012
  applied: yes
- id: GA-004
  kind: unmodeled_term
  target_ids: [todo-cli:CTR-006, todo-cli:POL-003, todo-cli:BEH-017, todo-cli:BEH-021]
  source: none
  resolution: decide
  required_change: |
    "The nouns `store` (used in the test_obligation predicates of todo-cli:BEH-021 and several Behaviors, e.g. \"empty store\", \"the store is rewritten\") and `contract shape` (used in todo-cli:CTR-006, todo-cli:BEH-017, todo-cli:POL-003) appear in normative fields but are absent from the Glossary of section 2. Add Glossary entries: `store` as the storage file of one invocation, and `contract shape` as the JSON root and task shape defined by todo-cli:CTR-006."
  assumption: null
  applied: yes
```

## Assumptions

```yaml
---
id: todo-cli:ASM-004
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: todo-cli
title: an unknown option is a usage error
assumption: "any token beginning with `--` in an argument position is an option, and every option that the Contract of the invoked command does not define, `--help` included, exits 2 with exactly one stderr line starting with `usage:` (code E_USAGE_UNKNOWN_OPTION); `--help` is recognized only as the command of todo-cli:CTR-005"
source_open_q: todo-cli:OQ-004
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests:
  - "an option other than `--all` exits 2 with a `usage:` line"
  - "`todo list --help` and `todo add --help` exit 2 with a `usage:` line"
notes: "decided by GA-002; source: L14, L21"
---
```

```yaml
---
id: todo-cli:ASM-012
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: todo-cli
title: extra positional arguments are ignored
assumption: "positional arguments beyond the ones the Contract of the invoked command defines are ignored: `todo done 1 2` marks task 1 done and leaves task 2 open, and `todo list foo` behaves as `todo list`; only `add` consumes every word as its text"
source_open_q: null
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests:
  - "`todo done 1 2` exits 0, prints `#1 done` and leaves task 2 open"
  - "`todo list foo` behaves as `todo list`"
notes: "decided by GA-003; source: none"
---
```

## Open-Q decisions

| Open-Q | option | finding | rationale |
| --- | --- | --- | --- |
| todo-cli:OQ-001 | A | none | Verified applied in round 1; already stated by todo-cli:BEH-002, todo-cli:CTR-001 and todo-cli:ASM-001. |
| todo-cli:OQ-002 | A | none | Verified applied in round 1; already stated by todo-cli:CTR-006 with todo-cli:ASM-002. |
| todo-cli:OQ-003 | A | none | Verified applied in round 1; already stated by todo-cli:CTR-006 with todo-cli:ASM-003. |
| todo-cli:OQ-004 | A | GA-002 | Verified applied in round 2; the generalised reading is stated by todo-cli:BEH-015, todo-cli:CTR-001, todo-cli:CTR-002 and the replaced todo-cli:ASM-004. |
| todo-cli:OQ-005 | A | none | Verified applied in round 1; already stated by todo-cli:CTR-003, todo-cli:CTR-004, todo-cli:BEH-014 and todo-cli:ASM-005. |
| todo-cli:OQ-006 | A | none | Verified applied in round 1; already stated by todo-cli:CTR-005 and todo-cli:ASM-006. |
| todo-cli:OQ-007 | A | none | Verified applied in round 1; already stated by todo-cli:CTR-001, todo-cli:BEH-003 and todo-cli:ASM-007. |
| todo-cli:OQ-008 | A | none | Verified applied in round 1; already stated by todo-cli:CTR-007 and todo-cli:ASM-008. |
| todo-cli:OQ-009 | A | none | Verified applied in round 1; already stated by todo-cli:BEH-009, todo-cli:BEH-011, todo-cli:BEH-012 and todo-cli:ASM-009. |
| todo-cli:OQ-010 | A | none | Verified applied in round 1; already stated by todo-cli:BEH-005, todo-cli:INV-004 and todo-cli:ASM-010. |
| todo-cli:OQ-011 | A | none | Verified applied in round 1; already stated by todo-cli:ASM-011. |

## Coverage

Round 2 is verification only; no new coverage findings. The round-1 coverage gap L34 is closed by todo-cli:NFR-001.
